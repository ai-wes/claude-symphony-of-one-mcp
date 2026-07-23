/**
 * Bug 4: missing CLI task routes
 *
 * server.js has GET /api/tasks/:room and POST /api/tasks/:taskId/update,
 * but is missing:
 *   GET /api/tasks/:room/:taskId   — fetch a single task
 *   PUT /api/tasks/:room/:taskId   — update a task
 *
 * RED: both routes return 404.
 * GREEN: both routes return 200 with correct data.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";

describe("Bug 4 – CLI task routes", () => {
  let srv;
  let taskId;
  const room = "cli-task-room";
  const agentId = randomUUID();

  before(async () => {
    srv = await startServer();

    // Join room
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "CliBot", capabilities: {} }),
    });

    // Create a task
    const res = await fetch(`http://localhost:${srv.port}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: room,
        title: "CLI Task",
        description: "testing CLI routes",
        creator: agentId,
        priority: "low",
      }),
    });
    const body = await res.json();
    taskId = body.task.id;
  });

  after(async () => {
    await srv.stop();
  });

  it("GET /api/tasks/:room/:taskId — returns 404 before fix (RED proof)", async () => {
    const res = await fetch(
      `http://localhost:${srv.port}/api/tasks/${room}/${taskId}`
    );
    // Before fix this returns 404.  After fix it returns 200.
    // We test the FINAL state: must be 200.
    assert.equal(res.status, 200, "GET /api/tasks/:room/:taskId must return 200");
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.task.id, taskId);
    assert.equal(body.task.title, "CLI Task");
  });

  it("PUT /api/tasks/:room/:taskId — updates task status", async () => {
    const res = await fetch(
      `http://localhost:${srv.port}/api/tasks/${room}/${taskId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in-progress", priority: "high" }),
      }
    );
    assert.equal(res.status, 200, "PUT /api/tasks/:room/:taskId must return 200");
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.task.status, "in-progress");
    assert.equal(body.task.priority, "high");
  });

  it("GET /api/tasks/:room/:taskId with wrong room returns 404", async () => {
    const res = await fetch(
      `http://localhost:${srv.port}/api/tasks/wrong-room/${taskId}`
    );
    assert.equal(res.status, 404);
  });
});
