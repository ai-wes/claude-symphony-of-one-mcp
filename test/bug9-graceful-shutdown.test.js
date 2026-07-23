/**
 * Bug 9: shutdown drain never completed with live socket clients
 *
 * The first version of the SIGTERM handler nested the DB flush inside
 * httpServer.close(...):
 *
 *     httpServer.close(() => { db.close(...) })
 *
 * httpServer.close() only fires its callback once every connection has
 * closed — and Socket.IO agents hold persistent connections. In production
 * the callback never ran, db.close() was never reached, and the process
 * force-exited on the timeout, dropping exactly the queued writes the
 * handler was added to protect.
 *
 * It passed the bug7 tests because those use plain fetch and leave no
 * lingering connections, so this test asserts the condition that actually
 * differs: a live socket.io client attached at shutdown.
 *
 * RED: shutdown hits the force-exit timeout (exit code 1) and the last
 *      message is missing after restart.
 * GREEN: exits 0 promptly and every acknowledged message survives.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { io as ioClient } from "socket.io-client";

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

function spawnServer(port, dbPath) {
  const child = spawn(process.execPath, [SERVER_JS], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      SHARED_DIR: path.join(os.tmpdir(), `shared-${randomUUID()}`),
      DATA_DIR: os.tmpdir(),
    },
    stdio: "pipe",
  });
  child.stdout.resume();
  child.stderr.resume();
  return child;
}

describe("Bug 9 – graceful shutdown with live socket clients", () => {
  it("drains and exits cleanly while a socket.io client is connected", async () => {
    const dbPath = path.join(os.tmpdir(), `bug9-${randomUUID()}.db`);
    const room = "shutdown-room";
    const agentId = randomUUID();

    const portA = randomPort();
    const childA = spawnServer(portA, dbPath);
    await waitForReady(portA);

    await fetch(`http://localhost:${portA}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "SocketBot", capabilities: {} }),
    });

    // The condition that broke production: a live persistent connection.
    const socket = ioClient(`http://localhost:${portA}`, {
      transports: ["websocket"],
      reconnection: false,
    });
    await new Promise((resolve, reject) => {
      socket.on("connect", resolve);
      socket.on("connect_error", reject);
      setTimeout(() => reject(new Error("socket did not connect")), 5000);
    });

    // Send, then kill immediately — the write is still queued in sqlite3.
    await fetch(`http://localhost:${portA}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, content: "written at shutdown" }),
    });

    const start = Date.now();
    childA.kill("SIGTERM");
    const exitCode = await new Promise((resolve) => {
      childA.once("exit", (code) => resolve(code));
      setTimeout(() => resolve("hung"), 10000);
    });
    const elapsed = Date.now() - start;
    socket.close();

    assert.equal(
      exitCode,
      0,
      `shutdown must complete cleanly, not hit the force-exit timeout (exit=${exitCode})`
    );
    assert.ok(
      elapsed < 5000,
      `shutdown must not block on the connection drain (took ${elapsed}ms)`
    );

    // The acknowledged write must be on disk.
    const portB = randomPort();
    const childB = spawnServer(portB, dbPath);
    await waitForReady(portB);
    const body = await (
      await fetch(`http://localhost:${portB}/api/messages/${room}`)
    ).json();
    childB.kill("SIGTERM");
    await new Promise((r) => {
      childB.once("exit", r);
      setTimeout(r, 3000);
    });
    try { await fs.unlink(dbPath); } catch {}

    assert.ok(
      body.messages.map((m) => m.content).includes("written at shutdown"),
      "a message acknowledged before SIGTERM must survive the restart"
    );
  });
});
