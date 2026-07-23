/**
 * Shared-token auth tests for the hub server.
 *
 * Case A — REST: token enforced when AUTH_TOKEN is set
 * Case B — Socket.IO: token enforced when AUTH_TOKEN is set
 * Case C — Graceful open mode (no AUTH_TOKEN)
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { startServer } from "./helpers.js";

const TOKEN = "test-secret-abc";

// Helper: attempt a Socket.IO connection and resolve with true (connected)
// or false (refused) after a short timeout.
function tryConnect(url, opts = {}) {
  return new Promise((resolve) => {
    const socket = io(url, { ...opts, reconnection: false });
    const timer = setTimeout(() => {
      socket.disconnect();
      resolve(false);
    }, 2000);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(true);
    });

    socket.on("connect_error", () => {
      clearTimeout(timer);
      socket.disconnect();
      resolve(false);
    });
  });
}

// ── Case A: REST auth enforced when AUTH_TOKEN is set ──────────────────────

describe("Case A – REST auth when AUTH_TOKEN is set", () => {
  let srv;

  before(async () => {
    srv = await startServer({ AUTH_TOKEN: TOKEN });
  });

  after(async () => {
    await srv.stop();
  });

  it("GET /api/rooms WITHOUT auth header → 401", async () => {
    const res = await fetch(`http://localhost:${srv.port}/api/rooms`);
    assert.equal(res.status, 401, "missing token must return 401");
  });

  it("GET /api/rooms WITH Authorization: Bearer token → 200", async () => {
    const res = await fetch(`http://localhost:${srv.port}/api/rooms`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(res.status, 200, "correct bearer token must return 200");
  });

  it("GET /api/rooms WITH x-auth-token header → 200", async () => {
    const res = await fetch(`http://localhost:${srv.port}/api/rooms`, {
      headers: { "x-auth-token": TOKEN },
    });
    assert.equal(res.status, 200, "correct x-auth-token must return 200");
  });

  it("GET /api/rooms WITH wrong token → 401", async () => {
    const res = await fetch(`http://localhost:${srv.port}/api/rooms`, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(res.status, 401, "wrong token must return 401");
  });
});

// ── Case B: Socket.IO auth enforced when AUTH_TOKEN is set ────────────────

describe("Case B – Socket.IO auth when AUTH_TOKEN is set", () => {
  let srv;

  before(async () => {
    srv = await startServer({ AUTH_TOKEN: TOKEN });
  });

  after(async () => {
    await srv.stop();
  });

  it("Socket.IO connection WITHOUT auth → refused", async () => {
    const connected = await tryConnect(`http://localhost:${srv.port}`);
    assert.equal(connected, false, "connection without token must be refused");
  });

  it("Socket.IO connection WITH correct auth token → connected", async () => {
    const connected = await tryConnect(`http://localhost:${srv.port}`, {
      auth: { token: TOKEN },
    });
    assert.equal(connected, true, "connection with correct token must succeed");
  });
});

// ── Case C: Graceful open mode when AUTH_TOKEN is NOT set ─────────────────

describe("Case C – open mode when AUTH_TOKEN is not set", () => {
  let srv;

  before(async () => {
    // Standard startServer() call with no extra env — open mode
    srv = await startServer();
  });

  after(async () => {
    await srv.stop();
  });

  it("GET /api/rooms WITHOUT auth header → 200 (open mode)", async () => {
    const res = await fetch(`http://localhost:${srv.port}/api/rooms`);
    assert.equal(res.status, 200, "open mode must allow unauthenticated requests");
  });
});
