/**
 * Bug 1: room_leave 404
 *
 * mcp-server.js line 199 calls POST /api/leave with a body — but
 * the actual server route is POST /api/leave/:agentId.
 *
 * RED sub-test: confirm POST /api/leave (wrong URL) returns 404.
 * GREEN sub-test: confirm POST /api/leave/:agentId returns 200.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { startServer } from "./helpers.js";

describe("Bug 1 – room_leave endpoint", () => {
  let srv;
  let agentId;
  const room = "test-room-bug1";

  before(async () => {
    srv = await startServer();
    agentId = randomUUID();

    // Register an agent with a known agentId
    const res = await fetch(
      `http://localhost:${srv.port}/api/join/${room}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId,
          agentName: "TestAgent",
          capabilities: {},
        }),
      }
    );
    assert.equal(res.status, 200);
  });

  after(async () => {
    await srv.stop();
  });

  it("POST /api/leave (wrong URL, body only) returns 404 — RED proof", async () => {
    // This is the buggy call from mcp-server.js line 199
    const res = await fetch(`http://localhost:${srv.port}/api/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    assert.equal(res.status, 404, "wrong URL must return 404");
  });

  it("POST /api/leave/:agentId returns 200 and removes agent", async () => {
    const leaveRes = await fetch(
      `http://localhost:${srv.port}/api/leave/${agentId}`,
      { method: "POST" }
    );
    assert.equal(leaveRes.status, 200);
    const body = await leaveRes.json();
    assert.equal(body.success, true);

    // Confirm agent is gone from the room
    const agentsRes = await fetch(
      `http://localhost:${srv.port}/api/agents/${room}`
    );
    const agentsBody = await agentsRes.json();
    const found = agentsBody.agents?.find((a) => a.id === agentId);
    assert.equal(found, undefined, "agent should no longer be in the room");
  });
});
