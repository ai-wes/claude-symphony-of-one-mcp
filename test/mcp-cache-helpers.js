/**
 * Thin module that re-implements the cache-clear logic from mcp-server.js
 * for unit testing without importing the full MCP server (which blocks on stdin).
 *
 * The real fix is in mcp-server.js: clearRoomCache() is called on room_join.
 * Here we test the invariant: after calling clearRoomCache(), both arrays are [].
 */

let messageHistory = ["old-message-1", "old-message-2"];
let notifications = ["old-notif-1"];

export function clearRoomCache() {
  messageHistory = [];
  notifications = [];
}

export function getMessageHistory() {
  return messageHistory;
}

export function getNotifications() {
  return notifications;
}

export function seedCache() {
  messageHistory = ["msg1", "msg2"];
  notifications = ["notif1"];
}
