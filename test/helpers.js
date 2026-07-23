/**
 * Test helpers for symphony-of-one-mcp.
 * Spawns server.js as a child process on an ephemeral port with a temp DB.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.resolve(__dirname, "../server.js");

/**
 * Pick a random port in the ephemeral range (49152–65535).
 */
function randomPort() {
  return Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152;
}

/**
 * Poll until GET /api/rooms returns any HTTP response (200 or 401),
 * or throw after maxMs. Any HTTP response means the server is up;
 * 401 is expected when AUTH_TOKEN is set.
 */
async function waitForReady(port, maxMs = 8000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}/api/rooms`);
      // Any response (including 401) means the server is listening.
      return;
    } catch {
      // not up yet — connection refused or network error
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server on port ${port} did not become ready within ${maxMs}ms`);
}

/**
 * Start a fresh server instance.
 * @param {Record<string,string>} extraEnv  Optional env vars layered on top (e.g. { AUTH_TOKEN: 'secret' }).
 * Returns { port, dbPath, stop() }.
 */
export async function startServer(extraEnv = {}) {
  const port = randomPort();
  const uid = randomUUID();
  const dbPath = path.join(os.tmpdir(), `test-${uid}.db`);
  const sharedDir = path.join(os.tmpdir(), `shared-${uid}`);
  const dataDir = os.tmpdir();

  const child = spawn(process.execPath, [SERVER_JS], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      SHARED_DIR: sharedDir,
      DATA_DIR: dataDir,
      ...extraEnv,
    },
    stdio: "pipe",
  });

  // Suppress server stdout/stderr in test output — uncomment to debug:
  // child.stdout.pipe(process.stdout);
  // child.stderr.pipe(process.stderr);

  child.stdout.resume();
  child.stderr.resume();

  await waitForReady(port);

  async function stop() {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 3000); // give up after 3 s
    });
    try {
      await fs.unlink(dbPath);
    } catch {
      // already gone
    }
  }

  return { port, dbPath, stop };
}
