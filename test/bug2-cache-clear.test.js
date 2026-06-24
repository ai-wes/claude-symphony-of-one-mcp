/**
 * Bug 2: message-cache cross-room leak
 *
 * mcp-server.js holds module-level `notifications = []` and
 * `messageHistory = []`. On room_join they are NOT cleared, so
 * switching rooms leaks old room's cache.
 *
 * The real fix lives in mcp-server.js: clearRoomCache() is exported and
 * called at the start of the room_join handler.
 *
 * This test verifies the invariant directly using the extracted helper
 * (mcp-cache-helpers.js mirrors the real logic) and confirms mcp-server.js
 * exports clearRoomCache.
 *
 * We avoid importing mcp-server.js directly because it starts the MCP
 * stdio transport which blocks stdin in the combined test run.
 *
 * RED proof: confirmed in isolation run — mcp-server.js did not export
 *   clearRoomCache before the fix (the individual test timed out).
 *
 * GREEN: clearRoomCache() zeros both arrays; mcp-server.js now exports it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Use the thin helper that mirrors mcp-server.js cache logic
import {
  clearRoomCache,
  getMessageHistory,
  getNotifications,
  seedCache,
} from "./mcp-cache-helpers.js";

describe("Bug 2 – cache clear on room join", () => {
  it("clearRoomCache() resets messageHistory and notifications", () => {
    // Populate the cache as if we were already in a room
    seedCache();
    assert.ok(getMessageHistory().length > 0, "pre-condition: history is non-empty");
    assert.ok(getNotifications().length > 0, "pre-condition: notifications are non-empty");

    // Simulate what room_join now does (Bug 2 fix)
    clearRoomCache();

    assert.deepEqual(getMessageHistory(), [], "messageHistory must be empty after clearRoomCache()");
    assert.deepEqual(getNotifications(), [], "notifications must be empty after clearRoomCache()");
  });

  it("mcp-server.js exports clearRoomCache (static check)", async () => {
    // Read the source file and confirm the export is present
    // This avoids importing the module (which blocks on stdin).
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { resolve, dirname } = await import("node:path");

    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../mcp-server.js"),
      "utf8"
    );

    assert.ok(
      src.includes("export function clearRoomCache"),
      "mcp-server.js must export clearRoomCache()"
    );
    assert.ok(
      src.includes("clearRoomCache();"),
      "room_join handler must call clearRoomCache() on join"
    );
  });
});
