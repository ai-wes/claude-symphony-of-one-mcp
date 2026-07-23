/**
 * Bug 5: dead task_assigned event
 *
 * server.js POST /api/tasks emits a "task" event, but NOT "task_assigned".
 * mcp-server.js listens for "task_assigned" which never fires.
 *
 * Fix: after the existing emit("task", ...) call, also emit("task_assigned", task)
 * when task.assignee is set.
 *
 * Test:
 *   - Connect a socket.io-client to the server
 *   - Join room via HTTP, then POST /api/tasks with an assignee
 *   - Expect "task_assigned" event on the socket
 *   - Also confirm that WITHOUT an assignee, the event is NOT emitted
 *
 * RED: "task_assigned" event never arrives (timeout).
 * GREEN: event arrives with the correct task.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";
import { io as ioClient } from "socket.io-client";

describe("Bug 5 – task_assigned socket event", () => {
  let srv;
  const room = "task-assigned-room";
  const agentId = randomUUID();

  before(async () => {
    srv = await startServer();

    // Join room via HTTP
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "Watcher", capabilities: {} }),
    });
  });

  after(async () => {
    await srv.stop();
  });

  it("emits task_assigned when task has an assignee", async () => {
    const client = ioClient(`http://localhost:${srv.port}`, {
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      client.on("connect_error", reject);
      client.on("connect", () => {
        client.emit("register", { agentId, room });
        resolve();
      });
    });

    const receivedEvent = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("task_assigned event was never received (timeout 3s)"));
      }, 3000);
      client.on("task_assigned", (task) => {
        clearTimeout(timer);
        resolve(task);
      });
    });

    // Create task WITH assignee
    const createRes = await fetch(`http://localhost:${srv.port}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: room,
        title: "Assigned Task",
        description: "should trigger task_assigned",
        assignee: "Watcher",
        creator: agentId,
        priority: "medium",
      }),
    });
    assert.equal(createRes.status, 200);
    const { task } = await createRes.json();

    const received = await receivedEvent;
    client.disconnect();

    assert.equal(received.id, task.id);
    assert.equal(received.title, "Assigned Task");
    assert.equal(received.assignee, "Watcher");
  });

  it("does NOT emit task_assigned when task has no assignee", async () => {
    const client = ioClient(`http://localhost:${srv.port}`, {
      transports: ["websocket"],
    });

    await new Promise((resolve, reject) => {
      client.on("connect_error", reject);
      client.on("connect", () => {
        client.emit("register", { agentId, room });
        resolve();
      });
    });

    let taskAssignedFired = false;
    client.on("task_assigned", () => { taskAssignedFired = true; });

    // Create task WITHOUT assignee
    await fetch(`http://localhost:${srv.port}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: room,
        title: "Unassigned Task",
        creator: agentId,
      }),
    });

    // Wait briefly to ensure no event fires
    await new Promise((r) => setTimeout(r, 500));
    client.disconnect();

    assert.equal(taskAssignedFired, false, "task_assigned must NOT fire without assignee");
  });
});
