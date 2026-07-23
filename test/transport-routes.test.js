/**
 * Contract test: every transport HTTP method must hit a route the hub serves.
 *
 * createTask() posted to /api/tasks/:room and updateTask() PATCHed
 * /api/tasks/:taskId — neither route exists on the hub, so both 404'd. Nothing
 * caught it: the existing transport test only asserts the METHODS EXIST on the
 * class, and every other test drove the REST API directly, bypassing the
 * transport entirely. In production this meant create_task never worked at all
 * (zero tasks in a database with 34 rooms and 1100+ messages).
 *
 * A 404 here means transport and server have drifted apart. Business-logic
 * failures (400/404-with-a-body for a genuinely missing entity) are fine —
 * this test only asserts the ROUTE resolves.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";

describe("Transport ↔ server route contract", () => {
  let srv;
  let transport;
  const room = `route-room-${randomUUID().slice(0, 8)}`;
  const agentId = randomUUID();

  before(async () => {
    srv = await startServer();
    const { createTransport } = await import("../transport/index.js");
    transport = createTransport({
      serverUrl: `http://localhost:${srv.port}`,
      authToken: "",
      agentName: "route-bot",
    });

    // Register the agent so room-scoped calls have something to act on.
    await fetch(`http://localhost:${srv.port}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "route-bot", capabilities: {} }),
    });
  });

  after(async () => {
    await srv.stop();
  });

  // Each entry: [label, () => Promise]. A rejection carrying HTTP 404 means
  // the transport is pointed at a route the server does not expose.
  const cases = () => [
    ["getMessages", () => transport.getMessages(room, undefined, 10)],
    ["getNotifications", () => transport.getNotifications(agentId, "route-bot", false)],
    ["createTask", () => transport.createTask(room, {
      title: "route check",
      description: "verifying the route resolves",
      creator: agentId,
      priority: "low",
    })],
    ["getTasks", () => transport.getTasks(room, {})],
    ["storeMemory", () => transport.storeMemory(agentId, {
      key: "route-key",
      value: "route-value",
      type: "note",
    })],
    ["retrieveMemory", () => transport.retrieveMemory(agentId, {})],
  ];

  for (const [label, call] of cases()) {
    it(`${label}() resolves to a real route`, async () => {
      let status = null;
      try {
        const res = await call();
        status = res?.status ?? 200;
      } catch (err) {
        status = err.response?.status ?? `network:${err.message}`;
      }
      assert.notEqual(
        status,
        404,
        `${label}() hit a route the server does not expose (404) — transport and server have drifted`
      );
      assert.notEqual(
        status,
        405,
        `${label}() used an HTTP method the server does not accept (405)`
      );
    });
  }

  it("updateTask() resolves to a real route", async () => {
    // Needs a real task id: a bogus one yields a legitimate 404 ("Task not
    // found") that would be indistinguishable from a missing route.
    const created = await transport.createTask(room, {
      title: "to update",
      description: "created so updateTask has a target",
      creator: agentId,
      priority: "low",
    });
    const taskId = created.data?.task?.id;
    assert.ok(taskId, `createTask should return a task id, got ${JSON.stringify(created.data)}`);

    let status = null;
    try {
      const res = await transport.updateTask(taskId, { status: "in_progress" });
      status = res?.status ?? 200;
    } catch (err) {
      status = err.response?.status ?? `network:${err.message}`;
    }
    assert.equal(
      status,
      200,
      `updateTask() should reach the hub's update route and succeed, got ${status}`
    );
  });
});
