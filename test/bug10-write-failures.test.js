/**
 * Bug 10: failed writes reported as success
 *
 * Every data write used fire-and-forget `db.run(sql, params)` with no
 * callback. sqlite3 swallows the error entirely in that form — no throw, no
 * log — and the routes never waited on the result. In /api/send the ordering
 * was:
 *
 *     push to in-memory array
 *     db.run(INSERT ...)        <- unchecked
 *     io.emit('message', ...)   <- every agent already saw it
 *     res.json({success: true}) <- sender told it worked
 *
 * so a failed INSERT meant the message was broadcast to the whole room,
 * acknowledged to the sender, and absent from disk — vanishing at the next
 * restart with nothing logged anywhere. The realistic trigger is SQLITE_BUSY
 * under concurrent writes, not disk-full.
 *
 * Writes are made to fail here by dropping the target table out from under
 * the running server, which is the least invasive way to provoke a genuine
 * sqlite3 error through the real code path.
 *
 * RED: 200 {success: true} and a silent loss.
 * GREEN: 500 with an explicit error, and the message is not broadcast.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sqlite3 from "sqlite3";
import { startServer } from "./helpers.js";

describe("Bug 10 – write failures surface as failures", () => {
  let srv;
  let base;
  const room = "write-fail-room";
  const agentId = randomUUID();

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;
    await fetch(`${base}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "WriteBot", capabilities: {} }),
    });
  });

  after(async () => {
    await srv.stop();
  });

  // Drop a table via a second connection to the same file, so the server's
  // next write against it genuinely errors.
  const dropTable = (table) =>
    new Promise((resolve, reject) => {
      const db = new sqlite3.Database(srv.dbPath);
      db.run(`DROP TABLE IF EXISTS ${table}`, (err) =>
        db.close(() => (err ? reject(err) : resolve()))
      );
    });

  it("sending a message succeeds normally first (control)", async () => {
    const res = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, content: "control message" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
  });

  it("a failed message write returns 500 instead of a false success", async () => {
    await dropTable("messages");

    const res = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, content: "should not be acknowledged" }),
    });

    assert.equal(
      res.status,
      500,
      "a message that could not be persisted must not be reported as sent"
    );
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /persist/i);
  });

  it("a failed message write is not added to the served history", async () => {
    const res = await fetch(`${base}/api/messages/${room}`);
    const body = await res.json();
    const contents = body.messages.map((m) => m.content);
    assert.ok(
      !contents.includes("should not be acknowledged"),
      "an unpersisted message must not appear in room history"
    );
  });

  it("a failed task write returns 500 instead of a false success", async () => {
    await dropTable("tasks");

    const res = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: room,
        title: "doomed task",
        description: "the tasks table is gone",
        creator: agentId,
        priority: "low",
      }),
    });

    assert.equal(
      res.status,
      500,
      "a task that could not be persisted must not be reported as created"
    );
    const body = await res.json();
    assert.equal(body.success, false);
  });

  it("a failed memory write returns 500 instead of a false success", async () => {
    await dropTable("agent_memory");

    const res = await fetch(`${base}/api/memory/${agentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "doomed", value: "gone", type: "note" }),
    });

    assert.equal(
      res.status,
      500,
      '"stored" must mean stored — a failed memory write cannot return success'
    );
    const body = await res.json();
    assert.equal(body.success, false);
  });
});

describe("Bug 10 – task update routes gate on the write", () => {
  let srv;
  let base;
  const room = "task-update-room";
  const agentId = randomUUID();
  let taskId;

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;
    await fetch(`${base}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "TaskBot", capabilities: {} }),
    });
    const created = await (
      await fetch(`${base}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomName: room,
          title: "updatable",
          description: "created before the table is dropped",
          creator: agentId,
          priority: "low",
        }),
      })
    ).json();
    taskId = created.task.id;
  });

  after(async () => {
    await srv.stop();
  });

  const dropTasks = () =>
    new Promise((resolve, reject) => {
      const db = new sqlite3.Database(srv.dbPath);
      db.run("DROP TABLE IF EXISTS tasks", (err) =>
        db.close(() => (err ? reject(err) : resolve()))
      );
    });

  it("both update routes succeed while the table exists (control)", async () => {
    const post = await fetch(`${base}/api/tasks/${taskId}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "in_progress" }),
    });
    assert.equal(post.status, 200, "POST update route control");

    const put = await fetch(`${base}/api/tasks/${room}/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority: "high" }),
    });
    assert.equal(put.status, 200, "PUT update route control");
  });

  it("POST /api/tasks/:taskId/update returns 500 on a failed write", async () => {
    await dropTasks();
    const res = await fetch(`${base}/api/tasks/${taskId}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    assert.equal(
      res.status,
      500,
      "an update that could not be persisted must not report success"
    );
  });

  it("PUT /api/tasks/:room/:taskId returns 500 on a failed write", async () => {
    const res = await fetch(`${base}/api/tasks/${room}/${taskId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "blocked" }),
    });
    assert.equal(
      res.status,
      500,
      "the CLI-facing update route must gate on the write too"
    );
  });
});

describe("Bug 10 – side-effect write failures degrade, not fail", () => {
  let srv;
  let base;
  const room = "side-effect-room";
  const senderId = randomUUID();
  const targetId = randomUUID();

  before(async () => {
    srv = await startServer();
    base = `http://localhost:${srv.port}`;
    for (const [id, name] of [
      [senderId, "sender"],
      [targetId, "target"],
    ]) {
      await fetch(`${base}/api/join/${room}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: id, agentName: name, capabilities: {} }),
      });
    }
  });

  after(async () => {
    await srv.stop();
  });

  it("a failed notification write does NOT fail the message send", async () => {
    // Notifications are a side effect of send — there is no caller waiting on
    // them, so the correct behaviour is to log and carry on rather than fail
    // a message that was itself persisted successfully.
    await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(srv.dbPath);
      db.run("DROP TABLE IF EXISTS notifications", (err) =>
        db.close(() => (err ? reject(err) : resolve()))
      );
    });

    const res = await fetch(`${base}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: senderId, content: "@target still sent" }),
    });

    assert.equal(
      res.status,
      200,
      "a message that persisted must still succeed even if its notification row fails"
    );
    const body = await res.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.mentions, ["target"]);

    // And the message itself is genuinely in history.
    const history = await (await fetch(`${base}/api/messages/${room}`)).json();
    assert.ok(
      history.messages.map((m) => m.content).includes("@target still sent"),
      "the message itself must be persisted and served"
    );
  });
});
