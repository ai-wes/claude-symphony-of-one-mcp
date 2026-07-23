#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createTransport } from "./transport/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = process.env.CHAT_SERVER_URL || "http://localhost:3000";
const SHARED_DIR = process.env.SHARED_DIR || path.join(process.cwd(), "shared");
const HUB_AUTH_TOKEN = process.env.AUTH_TOKEN || '';
// Set SYMPHONY_USE_MESSAGE_CACHE=true to use the local Socket.IO buffer for
// get_messages instead of always fetching from the server. Faster for
// single-agent local use; incorrect for multi-agent cross-machine coordination.
const USE_MESSAGE_CACHE = process.env.SYMPHONY_USE_MESSAGE_CACHE === 'true';

// Global state
let currentAgentId = null;
let currentRoom = null;
let transport = null;
let agentName = process.env.AGENT_NAME || `Agent-${uuidv4().slice(0, 8)}`;
let notifications = [];
let messageHistory = [];
let watchPatterns = [];

/**
 * Emit a copy-pasteable `since` cursor for the next poll.
 *
 * Message timestamps are stored as UTC ISO strings (`...Z`), so the cursor is
 * absolute and unambiguous regardless of the calling agent's timezone. Rendered
 * message lines use local time for readability, which is NOT valid `since`
 * input — this cursor is what agents should feed back.
 */
function formatCursor(messages) {
  if (!messages.length) return "";
  const newest = messages.reduce(
    (a, m) => (new Date(m.timestamp) > new Date(a.timestamp) ? m : a)
  );
  const iso = new Date(newest.timestamp).toISOString();
  return `\n\nNext poll: since=${iso}`;
}

// Ensure shared directory exists
async function ensureSharedDir() {
  try {
    await fs.access(SHARED_DIR);
  } catch {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    console.error(`Created shared directory: ${SHARED_DIR}`);
  }
}

// Create MCP server instance
const server = new McpServer({
  name: "claude-symphony-of-one-mcp",
  version: "1.0.0",
});

// Room Management Tools
server.registerTool(
  "room_join",
  {
    title: "Join Chat Room",
    description: "Join a chat room to collaborate with other agents",
    inputSchema: {
      roomName: z.string().describe("Name of the room to join"),
      agentName: z.string().optional().describe("Your agent name (optional)"),
      capabilities: z.object({
        skills: z.array(z.string()).optional(),
        role: z.string().optional(),
        expertise: z.string().optional(),
      }).optional().describe("Your capabilities and role"),
    },
  },
  async (params) => {
    currentAgentId = uuidv4();
    currentRoom = params.roomName;
    if (params.agentName) {
      agentName = params.agentName;
    }
    // Bug 2 fix: clear stale cache from any previous room
    clearRoomCache();

    try {
      transport = createTransport({ serverUrl: SERVER_URL, authToken: HUB_AUTH_TOKEN, agentName });

      // Register socket event callbacks before connecting
      transport.onMessage((message) => {
        messageHistory.push(message);
        // Keep only last 1000 messages
        if (messageHistory.length > 1000) {
          messageHistory = messageHistory.slice(-1000);
        }

        // Check for mentions
        if (message.mentions?.includes(agentName)) {
          notifications.push({
            id: uuidv4(),
            type: "mention",
            message: message,
            timestamp: new Date().toISOString(),
            read: false,
          });
        }

        for (const pattern of watchPatterns) {
          const content = message.content?.toLowerCase() || "";
          if (content.includes(pattern.toLowerCase())) {
            notifications.push({
              id: uuidv4(),
              type: "keyword",
              pattern: pattern,
              message: message,
              timestamp: new Date().toISOString(),
              read: false,
            });
            break;
          }
        }

        console.error(`[${message.agentName || "System"}]: ${message.content}`);
      });

      transport.onNotification((notifOrTask) => {
        if (notifOrTask._taskAssigned) {
          const task = notifOrTask.task;
          notifications.push({
            id: uuidv4(),
            type: "task",
            task: task,
            message: `Task assigned: ${task.title}`,
            timestamp: new Date().toISOString(),
            read: false,
          });
          console.error(`Task Assigned: ${task.title}`);
        } else {
          const notification = notifOrTask;
          notifications.push({
            id: uuidv4(),
            type: "system",
            ...notification,
            timestamp: new Date().toISOString(),
            read: false,
          });
          console.error(`Notification: ${notification.message}`);
        }
      });

      const response = await transport.connect(currentAgentId, params.roomName);

      return {
        content: [
          {
            type: "text",
            text: `Successfully joined room: ${params.roomName}\nAgent ID: ${currentAgentId}\nAgent Name: ${agentName}\nCurrent Agents: ${response?.data?.currentAgents?.length ?? 0}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to join room: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "room_leave",
  {
    title: "Leave Chat Room",
    description: "Leave the current chat room",
    inputSchema: {},
  },
  async () => {
    if (!currentAgentId) {
      return {
        content: [
          {
            type: "text",
            text: "Not connected to a room"
          }
        ],
        isError: true
      };
    }

    try {
      await transport.leaveRoom(currentAgentId);
      await transport.disconnect();

      const leftRoom = currentRoom;
      currentAgentId = null;
      currentRoom = null;
      transport = null;
      messageHistory = [];
      notifications = [];

      return {
        content: [
          {
            type: "text",
            text: `Left room "${leftRoom}"`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to leave room: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "send_message",
  {
    title: "Send Message",
    description: "Send a message to all agents in the current room (supports @mentions)",
    inputSchema: {
      content: z.string().describe("Message content"),
      metadata: z.object({
        type: z.enum(["code", "documentation", "question", "answer", "task"]).optional(),
        language: z.string().optional(),
        urgency: z.enum(["low", "normal", "high"]).optional(),
      }).optional().describe("Optional metadata"),
    },
  },
  async (params) => {
    if (!currentAgentId) {
      return {
        content: [
          {
            type: "text",
            text: "Not connected to a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    try {
      const sent = await transport.sendMessage(params.content, params.metadata || {});

      // Echo the mentions the SERVER actually parsed. Mention parsing has its
      // own rules (dots, hyphens, dedupe), so an agent that assumes its @name
      // resolved could be wrong with no way to tell.
      const mentions = sent?.data?.mentions;
      const mentionNote =
        Array.isArray(mentions) && mentions.length
          ? ` — notified: ${mentions.join(", ")}`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `Message sent to room "${currentRoom}"${mentionNote}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to send message: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "get_messages",
  {
    title: "Get Messages",
    description:
      "Get messages from the current room. To poll efficiently: call once with " +
      "no arguments, then reuse the 'Next poll: since=<ISO>' cursor printed at " +
      "the end of the output as the `since` argument on every later call — you " +
      "then receive only new messages. Pass limit:0 with `since` to get just " +
      "the COUNT of new messages without transferring any. Do NOT build a " +
      "`since` value from the displayed [3:04:12 PM] times; they are local " +
      "clock times, not valid timestamps, and will be rejected.",
    inputSchema: {
      since: z.string().optional().describe(
        "Full ISO 8601 timestamp to get messages after, e.g. 2026-07-23T21:00:00.000Z. " +
        "Must be a complete date+time — a clock time alone ('4:10 PM') is rejected. " +
        "Use the 'next poll' cursor printed at the end of this tool's output."
      ),
      limit: z.number().optional().describe(
        "Maximum number of messages (default: 50). Use 0 with `since` to get " +
        "only the COUNT of new messages without transferring any of them; the " +
        "response still reports how many matched."
      ),
    },
  },
  async (params) => {
    if (!currentRoom) {
      return {
        content: [
          {
            type: "text",
            text: "Not in a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    try {
      // Default: always fetch from server for authoritative state across agents.
      // Set SYMPHONY_USE_MESSAGE_CACHE=true for single-agent local use where
      // speed matters more than cross-machine correctness.
      if (USE_MESSAGE_CACHE && !params.since && messageHistory.length > 0) {
        const limit = params.limit ?? 50;
        const messages = limit === 0 ? [] : messageHistory.slice(-limit);
        return {
          content: [
            {
              type: "text",
              text: `Retrieved ${messages.length} messages from local cache:\n\n${messages.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.agentName}: ${m.content}`).join('\n')}`
            }
          ]
        };
      }

      // `params.limit || 50` turned an explicit limit of 0 into 50, so a
      // count-only query silently fetched a full page while the header
      // claimed nothing was fetched. Nullish-coalesce so 0 survives.
      const response = await transport.getMessages(
        currentRoom,
        params.since,
        params.limit ?? 50
      );

      const messages = response.data.messages;
      const { matched, hasMore } = response.data;

      // Never report a truncated page as if it were the whole window — that is
      // the same silent under-report the `since` filter used to produce.
      // Count-only: report the total plus a per-sender breakdown, so an agent
      // can see how much is new from itself and from everyone else in the room
      // without pulling any message bodies.
      if (params.limit === 0 && typeof matched === "number") {
        const byAgent = response.data.byAgent || {};
        const rows = Object.entries(byAgent)
          .sort((a, b) => b[1] - a[1])
          .map(([who, n]) => `  ${who}${who === agentName ? " (you)" : ""}: ${n}`)
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text:
                `${matched} new message(s) — count only, none fetched` +
                (rows ? `\n\nBy agent:\n${rows}` : ""),
            },
          ],
        };
      }

      const header =
        hasMore && typeof matched === "number"
            ? `Retrieved ${messages.length} of ${matched} matching messages ` +
              `(TRUNCATED — ${matched - messages.length} older ones not shown; ` +
              `poll again with the cursor below to continue, or raise 'limit')`
            : `Retrieved ${messages.length} messages from server`;

      return {
        content: [
          {
            type: "text",
            text: `${header}:\n\n${messages.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.agentName}: ${m.content}`).join('\n')}${formatCursor(messages)}`
          }
        ]
      };
    } catch (error) {
      // Surface the server's explanation (e.g. an invalid `since`) rather than
      // just "Request failed with status code 400".
      const detail = error.response?.data?.error;
      return {
        content: [
          {
            type: "text",
            text: `Failed to get messages: ${detail || error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "get_notifications",
  {
    title: "Get Notifications",
    description:
      "Get @mentions addressed to you, including ones sent while you were " +
      "offline. Reports the true unread total, which may exceed the page " +
      "shown. Mentions from other rooms are included and labelled '{room: x}' — " +
      "pass currentRoomOnly:true to exclude them. Use mark_notification_read " +
      "to clear one, otherwise your unread count only ever grows.",
    inputSchema: {
      unreadOnly: z.boolean().optional().describe("Only return unread notifications"),
      type: z.enum(["mention", "keyword", "task", "system"]).optional().describe("Filter by notification type"),
      currentRoomOnly: z.boolean().optional().describe(
        "Only return notifications from the room you are currently in. " +
        "Default false — mentions from other rooms are included, and every " +
        "notification is labelled with its room."
      ),
    },
  },
  async (params) => {
    if (!currentAgentId) {
      return {
        content: [
          {
            type: "text",
            text: "Not connected to a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    // Always fetch from server and merge with local socket-received notifications.
    // The local array only contains events received since this session's room_join;
    // server fetch catches @mentions sent before this agent was online.
    let serverNotifs = [];
    let serverCounts = null;
    if (transport) {
      try {
        const response = await transport.getNotifications(
          currentAgentId,
          agentName,
          params.unreadOnly,
          params.currentRoomOnly ? currentRoom : undefined
        );
        serverNotifs = (response.data?.notifications || []).map(n => ({
          ...n,
          read: !!n.is_read,
          timestamp: n.created_at,
        }));
        // Authoritative totals from the server; the returned page may be
        // smaller than the true unread count.
        serverCounts = {
          total: response.data?.total,
          unread: response.data?.unread,
          hasMore: response.data?.hasMore,
        };
      } catch (err) {
        console.error('[get_notifications] server fetch failed:', err.message);
      }
    }
    // Merge: server results take precedence; deduplicate by id.
    // The room filter must be applied to the LOCAL buffer too — the server
    // query honours it, but socket-received notifications bypass the server
    // entirely and would otherwise defeat the filter on their way back in.
    const seen = new Set(serverNotifs.map(n => n.id));
    const localOnly = notifications
      .filter(n => n.id && !seen.has(n.id))
      .filter(n => !params.currentRoomOnly || n.room === currentRoom);
    const allNotifications = [...serverNotifs, ...localOnly];

    let filtered = allNotifications;

    if (params.unreadOnly) {
      filtered = filtered.filter((n) => !n.read);
    }

    if (params.type) {
      filtered = filtered.filter((n) => n.type === params.type);
    }

    // Prefer the server's SQL-counted total; fall back to counting the page
    // only when the server didn't report one (older hub, or fetch failed).
    const unreadCount =
      typeof serverCounts?.unread === "number"
        ? serverCounts.unread
        : allNotifications.filter((n) => !n.read).length;

    // Label the source room: retrieval is not room-scoped by default, so an
    // unlabelled list made a mention from another room look like it came from
    // the one the agent is working in.
    const notificationList = filtered.map(n => {
      const where = n.room && n.room !== currentRoom ? ` {room: ${n.room}}` : '';
      return `[${n.type.toUpperCase()}]${where} ${n.message || (n.task ? n.task.title : 'System notification')} - ${new Date(n.timestamp).toLocaleString()}${n.read ? ' (READ)' : ' (UNREAD)'}`;
    }).join('\n');

    const truncated = serverCounts?.hasMore
      ? ` — TRUNCATED, use offset to page back`
      : "";

    return {
      content: [
        {
          type: "text",
          text: `Notifications (${filtered.length} shown, ${unreadCount} unread total${truncated}):\n\n${notificationList || 'No notifications'}`
        }
      ]
    };
  }
);

server.registerTool(
  "update_task",
  {
    title: "Update Task",
    description:
      "Change a task's status, assignee or priority. Without this a task can " +
      "be created and listed but never moved to done.",
    inputSchema: {
      taskId: z.string().describe("Task id (from get_tasks)"),
      status: z.enum(["todo", "in_progress", "review", "done", "blocked"]).optional()
        .describe("New status"),
      assignee: z.string().optional().describe("Agent name to assign to"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("New priority"),
    },
  },
  async (params) => {
    if (!transport) {
      return {
        content: [{ type: "text", text: "Not connected to a hub. Use room_join first." }],
        isError: true,
      };
    }
    try {
      const { taskId, ...patch } = params;
      const res = await transport.updateTask(taskId, patch);
      const task = res.data?.task;
      return {
        content: [
          {
            type: "text",
            text: task
              ? `Task updated: "${task.title}" -> status=${task.status}, assignee=${task.assignee || "unassigned"}, priority=${task.priority}`
              : `Task ${taskId} updated`,
          },
        ],
      };
    } catch (error) {
      const detail = error.response?.data?.error;
      return {
        content: [{ type: "text", text: `Failed to update task: ${detail || error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "mark_notification_read",
  {
    title: "Mark Notification Read",
    description:
      "Mark one notification as read so it stops counting toward your unread " +
      "total. Notification ids come from get_notifications.",
    inputSchema: {
      notificationId: z.string().describe("Notification id from get_notifications"),
    },
  },
  async (params) => {
    if (!transport) {
      return {
        content: [{ type: "text", text: "Not connected to a hub. Use room_join first." }],
        isError: true,
      };
    }
    try {
      const res = await transport.markNotificationRead(params.notificationId);
      const updated = res.data?.updated;
      return {
        content: [
          {
            type: "text",
            text: updated
              ? `Notification ${params.notificationId} marked read`
              : `No notification matched id ${params.notificationId} (already read, or wrong id)`,
          },
        ],
      };
    } catch (error) {
      const detail = error.response?.data?.error;
      return {
        content: [{ type: "text", text: `Failed to mark notification read: ${detail || error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_rooms",
  {
    title: "List Rooms",
    description: "List every room on the hub with how many agents are in each.",
    inputSchema: {},
  },
  async () => {
    if (!transport) {
      return {
        content: [{ type: "text", text: "Not connected to a hub. Use room_join first." }],
        isError: true,
      };
    }
    try {
      const res = await transport.getRooms();
      const rooms = res.data?.rooms || [];
      const lines = rooms
        .map((r) => `  ${r.name}${r.name === currentRoom ? " (current)" : ""}: ${r.agentCount} agents`)
        .join("\n");
      return {
        content: [
          { type: "text", text: rooms.length ? `Rooms (${rooms.length}):\n${lines}` : "No rooms" },
        ],
      };
    } catch (error) {
      const detail = error.response?.data?.error;
      return {
        content: [{ type: "text", text: `Failed to list rooms: ${detail || error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "list_agents",
  {
    title: "List Agents",
    description: "List the agents currently in a room — who you can @mention.",
    inputSchema: {
      room: z.string().optional().describe("Room name (defaults to your current room)"),
    },
  },
  async (params) => {
    const target = params.room || currentRoom;
    if (!transport || !target) {
      return {
        content: [{ type: "text", text: "Not in a room. Use room_join first, or pass `room`." }],
        isError: true,
      };
    }
    try {
      const res = await transport.getAgents(target);
      const list = res.data?.agents || [];
      const lines = list
        .map((a) => `  ${a.name}${a.status ? ` [${a.status}]` : ""}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: list.length
              ? `Agents in "${target}" (${list.length}):\n${lines}`
              : `No agents currently in "${target}"`,
          },
        ],
      };
    } catch (error) {
      const detail = error.response?.data?.error;
      return {
        content: [{ type: "text", text: `Failed to list agents: ${detail || error.message}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "get_room_stats",
  {
    title: "Get Room Stats",
    description:
      "Count messages/agents per room WITHOUT fetching message bodies. " +
      "Use this to check whether a room is worth polling, or how far behind " +
      "you are, instead of pulling messages just to count them.",
    inputSchema: {
      allRooms: z.boolean().optional().describe(
        "Include every room. Default false — only the room you are in."
      ),
    },
  },
  async (params) => {
    if (!transport) {
      return {
        content: [
          { type: "text", text: "Not connected to a hub. Use room_join first." }
        ],
        isError: true
      };
    }

    try {
      const response = await transport.getStats();
      const data = response.data || {};
      const rooms = data.rooms || [];
      const shown = params.allRooms
        ? rooms
        : rooms.filter((r) => r.name === currentRoom);

      if (!shown.length) {
        return {
          content: [
            {
              type: "text",
              text: currentRoom
                ? `No stats for room "${currentRoom}" (it may have no activity yet).`
                : "Not in a room — pass allRooms: true to see every room."
            }
          ]
        };
      }

      const lines = shown
        .sort((a, b) => b.messageCount - a.messageCount)
        .map(
          (r) =>
            `  ${r.name}${r.name === currentRoom ? " (current)" : ""}: ` +
            `${r.messageCount} messages, ${r.agentCount} agents`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text:
              `Room stats (counts only — no messages fetched):\n${lines}\n\n` +
              `Hub totals: ${data.totalRooms} rooms, ${data.totalAgents} agents, ${data.totalTasks} tasks`
          }
        ]
      };
    } catch (error) {
      const detail = error.response?.data?.error;
      return {
        content: [
          { type: "text", text: `Failed to get stats: ${detail || error.message}` }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "create_task",
  {
    title: "Create Task",
    description: "Create a new task for coordination",
    inputSchema: {
      title: z.string().describe("Task title"),
      description: z.string().describe("Task description"),
      assignee: z.string().optional().describe("Agent to assign to"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Task priority (default: medium)"),
    },
  },
  async (params) => {
    if (!currentRoom) {
      return {
        content: [
          {
            type: "text",
            text: "Not in a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    try {
      await transport.createTask(currentRoom, {
        title: params.title,
        description: params.description,
        assignee: params.assignee,
        priority: params.priority || "medium",
        creator: agentName,
      });

      return {
        content: [
          {
            type: "text",
            text: `Task created successfully:\nTitle: ${params.title}\nDescription: ${params.description}\nAssignee: ${params.assignee || 'Unassigned'}\nPriority: ${params.priority || 'medium'}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to create task: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "get_tasks",
  {
    title: "Get Tasks",
    description: "Get tasks assigned to you or in the room",
    inputSchema: {
      status: z.enum(["todo", "in_progress", "review", "done", "blocked"]).optional().describe("Filter by status"),
      assignee: z.string().optional().describe("Filter by assignee (defaults to you)"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("Filter by priority"),
    },
  },
  async (params) => {
    if (!currentRoom) {
      return {
        content: [
          {
            type: "text",
            text: "Not in a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    try {
      const response = await transport.getTasks(currentRoom, {
        status: params.status,
        assignee: params.assignee || agentName,
        priority: params.priority,
      });

      const tasks = response.data.tasks;
      // The id must be shown: update_task takes a taskId, and this is the only
      // tool that can supply one.
      const taskList = tasks.map(task =>
        `[${task.status.toUpperCase()}] ${task.title}\n  id: ${task.id}\n  Description: ${task.description}\n  Assignee: ${task.assignee || 'Unassigned'}\n  Priority: ${task.priority}\n  Created: ${new Date(task.createdAt).toLocaleString()}`
      ).join('\n\n');

      return {
        content: [
          {
            type: "text",
            text: `Tasks in room "${currentRoom}" (${tasks.length} found):\n\n${taskList || 'No tasks found'}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get tasks: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "memory_store",
  {
    title: "Store Memory",
    description: "Store information in persistent memory",
    inputSchema: {
      key: z.string().describe("Memory key"),
      value: z.string().describe("Memory value"),
      type: z.string().optional().describe("Memory type (e.g., note, context, learning)"),
      expiresIn: z.number().optional().describe("Expiration time in seconds (optional)"),
    },
  },
  async (params) => {
    if (!currentAgentId) {
      return {
        content: [
          {
            type: "text",
            text: "Not connected to a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    try {
      await transport.storeMemory(currentAgentId, {
        key: params.key,
        value: params.value,
        type: params.type || "note",
        expiresIn: params.expiresIn,
      });

      return {
        content: [
          {
            type: "text",
            text: `Memory stored successfully: ${params.key}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to store memory: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "memory_retrieve",
  {
    title: "Retrieve Memory",
    description: "Retrieve information from persistent memory",
    inputSchema: {
      key: z.string().optional().describe("Memory key (optional, returns all if not specified)"),
      type: z.string().optional().describe("Filter by memory type"),
    },
  },
  async (params) => {
    if (!currentAgentId) {
      return {
        content: [
          {
            type: "text",
            text: "Not connected to a room. Use room_join first."
          }
        ],
        isError: true
      };
    }

    try {
      const response = await transport.retrieveMemory(currentAgentId, {
        key: params.key,
        type: params.type,
      });

      const memories = response.data.memories;
      const memoryList = memories.map(m =>
        `Key: ${m.key}\nValue: ${m.value}\nType: ${m.type || 'note'}\nCreated: ${new Date(m.created_at).toLocaleString()}`
      ).join('\n\n');

      return {
        content: [
          {
            type: "text",
            text: `Retrieved memories (${memories.length} found):\n\n${memoryList || 'No memories found'}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to retrieve memory: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

// File system tools for shared workspace
server.registerTool(
  "file_read",
  {
    title: "Read File",
    description: "Read a file from the shared workspace",
    inputSchema: {
      filename: z.string().describe("Name of the file to read"),
    },
  },
  async (params) => {
    try {
      const filePath = path.join(SHARED_DIR, params.filename);

      // Security check - ensure file is within shared directory
      const resolvedPath = path.resolve(filePath);
      const resolvedSharedDir = path.resolve(SHARED_DIR);
      if (!resolvedPath.startsWith(resolvedSharedDir)) {
        return {
          content: [
            {
              type: "text",
              text: "Access denied: File must be within shared directory"
            }
          ],
          isError: true
        };
      }

      const content = await fs.readFile(filePath, 'utf8');
      return {
        content: [
          {
            type: "text",
            text: `Content of ${params.filename}:\n\n${content}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to read file: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "file_write",
  {
    title: "Write File",
    description: "Write content to a file in the shared workspace",
    inputSchema: {
      filename: z.string().describe("Name of the file to write"),
      content: z.string().describe("Content to write to the file"),
    },
  },
  async (params) => {
    try {
      const filePath = path.join(SHARED_DIR, params.filename);

      // Security check - ensure file is within shared directory
      const resolvedPath = path.resolve(filePath);
      const resolvedSharedDir = path.resolve(SHARED_DIR);
      if (!resolvedPath.startsWith(resolvedSharedDir)) {
        return {
          content: [
            {
              type: "text",
              text: "Access denied: File must be within shared directory"
            }
          ],
          isError: true
        };
      }

      await fs.writeFile(filePath, params.content, 'utf8');
      return {
        content: [
          {
            type: "text",
            text: `Successfully wrote content to ${params.filename}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to write file: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

server.registerTool(
  "file_list",
  {
    title: "List Files",
    description: "List files in the shared workspace directory",
    inputSchema: {
      subdirectory: z.string().optional().describe("Subdirectory to list (optional)"),
    },
  },
  async (params) => {
    try {
      const targetDir = params.subdirectory
        ? path.join(SHARED_DIR, params.subdirectory)
        : SHARED_DIR;

      // Security check - ensure directory is within shared directory
      const resolvedPath = path.resolve(targetDir);
      const resolvedSharedDir = path.resolve(SHARED_DIR);
      if (!resolvedPath.startsWith(resolvedSharedDir)) {
        return {
          content: [
            {
              type: "text",
              text: "Access denied: Directory must be within shared directory"
            }
          ],
          isError: true
        };
      }

      const files = await fs.readdir(targetDir, { withFileTypes: true });
      const fileList = files.map(file => {
        const type = file.isDirectory() ? 'DIR' : 'FILE';
        return `[${type}] ${file.name}`;
      }).join('\n');

      return {
        content: [
          {
            type: "text",
            text: `Files in ${params.subdirectory || 'shared directory'}:\n\n${fileList || 'No files found'}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to list files: ${error.message}`
          }
        ],
        isError: true
      };
    }
  }
);

// Exported helpers for testing (and for clearRoomCache used in room_join)
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

// Start the server
async function main() {
  console.error(`Starting Symphony of One MCP Server v1.0.0`);
  console.error(`Hub Server: ${SERVER_URL}`);
  console.error(`Agent Name: ${agentName}`);
  console.error(`Shared Directory: ${SHARED_DIR}`);

  await ensureSharedDir();

  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  console.error(`MCP Server connected and ready for Claude`);
}

main().catch((error) => {
  console.error(`Failed to start MCP server: ${error.message}`);
  process.exit(1);
});
