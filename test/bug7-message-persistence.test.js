/**
 * Bug 7: message history is write-only
 *
 * Messages are INSERTed into the `messages` table but were never read back:
 * loadDataFromDatabase() initialised every room with `messages.set(name, [])`.
 * GET /api/messages/:room reads only that in-memory Map, so every restart left
 * the API blind to history sitting on disk.
 *
 * This is the more dangerous half of the `since` bug (see bug6): after a
 * restart, `?since=<valid ISO>` returns an empty list that is *truthful* for
 * the in-memory state and completely wrong about the room — so the NaN guard
 * in bug6 cannot catch it.
 *
 * Test sequence:
 *   1. Start server A with a temp DB, join, send messages.
 *   2. Stop server A (keeping its DB).
 *   3. Start server B on the SAME DB.
 *   4. GET /api/messages/:room — history must still be there.
 *
 * RED: step 4 returns 0 messages (before fix).
 * GREEN: step 4 returns the messages, in chronological order.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER_JS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../server.js"
);

function randomPort() {
  return Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
}

async function waitForReady(port, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/api/rooms`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server on port ${port} not ready in ${maxMs}ms`);
}

function spawnServer(port, dbPath, extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER_JS], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      SHARED_DIR: path.join(os.tmpdir(), `shared-${randomUUID()}`),
      DATA_DIR: os.tmpdir(),
      ...extraEnv,
    },
    stdio: "pipe",
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((r) => {
    child.once("exit", r);
    setTimeout(r, 3000);
  });
}

const send = (port, agentId, content) =>
  fetch(`http://localhost:${port}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, content }),
  });

const join = (port, room, agentId, agentName) =>
  fetch(`http://localhost:${port}/api/join/${room}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, agentName, capabilities: {} }),
  });

describe("Bug 7 – message persistence across restarts", () => {
  it("message history survives server restart (reads from DB on boot)", async () => {
    const dbPath = path.join(os.tmpdir(), `bug7-${randomUUID()}.db`);
    const room = "msg-persist-room";
    const agentId = randomUUID();

    // ---- Server A ----
    const portA = randomPort();
    const childA = spawnServer(portA, dbPath);
    await waitForReady(portA);

    await join(portA, room, agentId, "PersistBot");
    await send(portA, agentId, "first across restart");
    await new Promise((r) => setTimeout(r, 25));
    await send(portA, agentId, "second across restart");

    await stopChild(childA);

    // ---- Server B — same DB ----
    const portB = randomPort();
    const childB = spawnServer(portB, dbPath);
    await waitForReady(portB);

    const res = await fetch(`http://localhost:${portB}/api/messages/${room}`);
    const body = await res.json();

    await stopChild(childB);
    try { await fs.unlink(dbPath); } catch {}

    const contents = body.messages.map((m) => m.content);
    assert.ok(
      contents.includes("first across restart"),
      `history should survive restart (loaded from DB); got ${JSON.stringify(contents)}`
    );
    assert.ok(
      contents.includes("second across restart"),
      "all persisted messages should be rehydrated"
    );
    assert.ok(
      contents.indexOf("first across restart") <
        contents.indexOf("second across restart"),
      "rehydrated messages must be in chronological order"
    );
  });

  it("`since` still filters correctly against rehydrated history", async () => {
    const dbPath = path.join(os.tmpdir(), `bug7-since-${randomUUID()}.db`);
    const room = "msg-since-room";
    const agentId = randomUUID();

    const portA = randomPort();
    const childA = spawnServer(portA, dbPath);
    await waitForReady(portA);

    await join(portA, room, agentId, "PersistBot");
    await send(portA, agentId, "old message");

    const before = await fetch(`http://localhost:${portA}/api/messages/${room}`);
    const beforeBody = await before.json();
    const cursor =
      beforeBody.messages[beforeBody.messages.length - 1].timestamp;

    await new Promise((r) => setTimeout(r, 25));
    await send(portA, agentId, "new message");
    await stopChild(childA);

    const portB = randomPort();
    const childB = spawnServer(portB, dbPath);
    await waitForReady(portB);

    const res = await fetch(
      `http://localhost:${portB}/api/messages/${room}?since=${encodeURIComponent(cursor)}`
    );
    const body = await res.json();

    await stopChild(childB);
    try { await fs.unlink(dbPath); } catch {}

    const contents = body.messages.map((m) => m.content);
    assert.ok(
      contents.includes("new message"),
      `a cursor taken before a restart must still return newer messages; got ${JSON.stringify(contents)}`
    );
    assert.ok(
      !contents.includes("old message"),
      "messages at or before the cursor must stay excluded"
    );
  });

  it("respects MESSAGE_HISTORY_LIMIT when rehydrating", async () => {
    const dbPath = path.join(os.tmpdir(), `bug7-limit-${randomUUID()}.db`);
    const room = "msg-limit-room";
    const agentId = randomUUID();

    const portA = randomPort();
    const childA = spawnServer(portA, dbPath);
    await waitForReady(portA);

    await join(portA, room, agentId, "PersistBot");
    for (let i = 0; i < 6; i++) {
      await send(portA, agentId, `msg-${i}`);
    }
    await stopChild(childA);

    // Rehydrate with a limit of 3 — must keep the NEWEST three.
    const portB = randomPort();
    const childB = spawnServer(portB, dbPath, { MESSAGE_HISTORY_LIMIT: "3" });
    await waitForReady(portB);

    const res = await fetch(`http://localhost:${portB}/api/messages/${room}`);
    const body = await res.json();

    await stopChild(childB);
    try { await fs.unlink(dbPath); } catch {}

    const contents = body.messages.map((m) => m.content);
    assert.equal(contents.length, 3, `expected 3 messages, got ${contents.length}`);
    assert.ok(
      contents.includes("msg-5"),
      `the newest messages must be kept, not the oldest; got ${JSON.stringify(contents)}`
    );
    assert.ok(!contents.includes("msg-0"), "oldest messages should be dropped");
  });
});
