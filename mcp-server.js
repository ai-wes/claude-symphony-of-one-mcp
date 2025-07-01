#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { io } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = process.env.CHAT_SERVER_URL || "http://localhost:3000";
const SHARED_DIR = process.env.SHARED_DIR || path.join(process.cwd(), "shared");

// Global state
let currentAgentId = null;
let currentRoom = null;
let socket = null;
let agentName = process.env.AGENT_NAME || `Agent-${uuidv4().slice(0, 8)}`;
let notifications = [];
let messageHistory = [];
let watchPatterns = [];

// Ensure shared directory exists
async function ensureSharedDir() {
  try {
    await fs.access(SHARED_DIR);
  } catch {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    console.error(`Created shared directory: ${SHARED_DIR}`);
  }
}

// Initialize socket connection
function connectSocket() {
  if (socket) socket.disconnect();

  socket = io(SERVER_URL);

  socket.on("connect", () => {
    console.error(`[${agentName}] Connected to chat server at ${SERVER_URL}`);
    if (currentAgentId && currentRoom) {
      socket.emit("register", { agentId: currentAgentId, room: currentRoom });
    }
  });

  socket.on("message", (message) => {
    messageHistory.push(message);
    // Keep only last 1000 messages
    if (messageHistory.length > 1000) {
      messageHistory = messageHistory.slice(-1000);
    }

    // Check for notifications
    const content = message.content?.toLowerCase() || "";
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

  socket.on("notification", (notification) => {
    notifications.push({
      id: uuidv4(),
      type: "system",
      ...notification,
      timestamp: new Date().toISOString(),
      read: false,
    });
    console.error(`Notification: ${notification.message}`);
  });

  socket.on("task_assigned", (task) => {
    notifications.push({
      id: uuidv4(),
      type: "task",
      task: task,
      message: `Task assigned: ${task.title}`,
      timestamp: new Date().toISOString(),
      read: false,
    });
    console.error(`Task Assigned: ${task.title}`);
  });

  socket.on("disconnect", () => {
    console.error(`[${agentName}] Disconnected from chat server`);
  });
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

    try {
      const response = await axios.post(
        `${SERVER_URL}/api/join/${params.roomName}`,
        {
          agentId: currentAgentId,
          agentName: agentName,
          capabilities: params.capabilities || {
            role: "ai-agent",
            type: "claude",
          },
        }
      );

      connectSocket();

      return {
        content: [
          {
            type: "text",
            text: `Successfully joined room: ${params.roomName}\nAgent ID: ${currentAgentId}\nAgent Name: ${agentName}\nCurrent Agents: ${response.data.currentAgents.length}`
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
      await axios.post(`${SERVER_URL}/api/leave`, {
        agentId: currentAgentId,
      });

      if (socket) {
        socket.disconnect();
        socket = null;
      }

      const leftRoom = currentRoom;
      currentAgentId = null;
      currentRoom = null;
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
      await axios.post(`${SERVER_URL}/api/send`, {
        agentId: currentAgentId,
        content: params.content,
        metadata: params.metadata || {},
      });

      return {
        content: [
          {
            type: "text",
            text: `Message sent to room "${currentRoom}"`
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
    description: "Get recent messages from current room",
    inputSchema: {
      since: z.string().optional().describe("ISO timestamp to get messages after"),
      limit: z.number().optional().describe("Maximum number of messages (default: 50)"),
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
      // First try to get from local history
      if (!params.since && messageHistory.length > 0) {
        const limit = params.limit || 50;
        const messages = messageHistory.slice(-limit);
        return {
          content: [
            {
              type: "text",
              text: `Retrieved ${messages.length} messages from local cache:\n\n${messages.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.agentName}: ${m.content}`).join('\n')}`
            }
          ]
        };
      }

      // Otherwise fetch from server
      const response = await axios.get(
        `${SERVER_URL}/api/messages/${currentRoom}`,
        {
          params: {
            since: params.since,
            limit: params.limit || 50,
          },
        }
      );

      const messages = response.data.messages;
      return {
        content: [
          {
            type: "text",
            text: `Retrieved ${messages.length} messages from server:\n\n${messages.map(m => `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.agentName}: ${m.content}`).join('\n')}`
          }
        ]
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to get messages: ${error.message}`
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
    description: "Get your notifications and mentions",
    inputSchema: {
      unreadOnly: z.boolean().optional().describe("Only return unread notifications"),
      type: z.enum(["mention", "keyword", "task", "system"]).optional().describe("Filter by notification type"),
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

    let filtered = notifications;

    if (params.unreadOnly) {
      filtered = filtered.filter((n) => !n.read);
    }

    if (params.type) {
      filtered = filtered.filter((n) => n.type === params.type);
    }

    const unreadCount = notifications.filter((n) => !n.read).length;
    const notificationList = filtered.map(n => 
      `[${n.type.toUpperCase()}] ${n.message || (n.task ? n.task.title : 'System notification')} - ${new Date(n.timestamp).toLocaleString()}${n.read ? ' (READ)' : ' (UNREAD)'}`
    ).join('\n');

    return {
      content: [
        {
          type: "text",
          text: `Notifications (${filtered.length} shown, ${unreadCount} unread total):\n\n${notificationList || 'No notifications'}`
        }
      ]
    };
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
      const response = await axios.post(
        `${SERVER_URL}/api/tasks/${currentRoom}`,
        {
          title: params.title,
          description: params.description,
          assignee: params.assignee,
          priority: params.priority || "medium",
          creator: agentName,
        }
      );

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
      const response = await axios.get(`${SERVER_URL}/api/tasks/${currentRoom}`, {
        params: {
          status: params.status,
          assignee: params.assignee || agentName,
          priority: params.priority,
        },
      });

      const tasks = response.data.tasks;
      const taskList = tasks.map(task => 
        `[${task.status.toUpperCase()}] ${task.title}\n  Description: ${task.description}\n  Assignee: ${task.assignee || 'Unassigned'}\n  Priority: ${task.priority}\n  Created: ${new Date(task.createdAt).toLocaleString()}`
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
      await axios.post(`${SERVER_URL}/api/memory/${currentAgentId}`, {
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
      const queryParams = new URLSearchParams();
      if (params.key) queryParams.append("key", params.key);
      if (params.type) queryParams.append("type", params.type);

      const response = await axios.get(
        `${SERVER_URL}/api/memory/${currentAgentId}?${queryParams}`
      );

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

// Start the server
async function main() {
  console.error(`Starting Symphony of One MCP Server v1.0.0`);
  console.error(`Hub Server: ${SERVER_URL}`);
  console.error(`Agent Name: ${agentName}`);
  console.error(`Shared Directory: ${SHARED_DIR}`);

  await ensureSharedDir();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(`MCP Server connected and ready for Claude`);
}

main().catch((error) => {
  console.error(`Failed to start MCP server: ${error.message}`);
  process.exit(1);
});