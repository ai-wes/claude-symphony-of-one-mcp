/**
 * Bug 3: task persistence
 *
 * Tasks are stored in the in-memory `tasks` Map but never written to
 * the `tasks` SQL table.  GET /api/tasks/:room reads from the Map, so
 * tasks survive within a process, but vanish on restart.
 *
 * Test sequence:
 *   1. Start server A with a temp DB.
 *   2. Join room + create a task.
 *   3. Stop server A (without deleting its DB).
 *   4. Start server B reusing the SAME temp DB.
 *   5. GET /api/tasks/:room — task must still be there.
 *
 * RED: step 5 returns 0 tasks (before fix).
 * GREEN: step 5 returns the task (after fix).
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

async function stopChild(child) {
  child.kill("SIGTERM");
  await new Promise((r) => {
    child.once("exit", r);
    setTimeout(r, 3000);
  });
}

describe("Bug 3 – task persistence across restarts", () => {
  it("task survives server restart (reads from DB on boot)", async () => {
    const uid = randomUUID();
    const dbPath = path.join(os.tmpdir(), `bug3-${uid}.db`);
    const room = "persist-room";
    const agentId = randomUUID();

    // ---- Server A ----
    const portA = randomPort();
    const childA = spawnServer(portA, dbPath);
    await waitForReady(portA);

    // Join room
    await fetch(`http://localhost:${portA}/api/join/${room}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, agentName: "TestBot", capabilities: {} }),
    });

    // Create task
    const createRes = await fetch(`http://localhost:${portA}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomName: room,
        title: "Persist me",
        description: "Should survive restart",
        creator: agentId,
        priority: "high",
      }),
    });
    assert.equal(createRes.status, 200);
    const { task } = await createRes.json();
    const taskId = task.id;

    // Stop Server A (preserves DB file)
    await stopChild(childA);

    // ---- Server B — same DB ----
    const portB = randomPort();
    const childB = spawnServer(portB, dbPath);
    await waitForReady(portB);

    const afterRes = await fetch(`http://localhost:${portB}/api/tasks/${room}`);
    const afterBody = await afterRes.json();

    // Clean up
    await stopChild(childB);
    try { await fs.unlink(dbPath); } catch {}

    assert.equal(
      afterBody.tasks.length,
      1,
      "task should survive restart (loaded from DB)"
    );
    assert.equal(afterBody.tasks[0].id, taskId);
    assert.equal(afterBody.tasks[0].title, "Persist me");
  });
});
