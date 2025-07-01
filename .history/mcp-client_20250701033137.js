#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { io } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

const SERVER_URL = process.env.CHAT_SERVER_URL || "http://localhost:3000";

// Global state
let currentAgentId = null;
let currentRoom = null;
let socket = null;

// Initialize socket connection
function connectSocket() {
  if (socket) socket.disconnect();

  socket = io(SERVER_URL);

  socket.on("connect", () => {
    console.error(`Connected to chat server at ${SERVER_URL}`);
    if (currentAgentId && currentRoom) {
      socket.emit("register", { agentId: currentAgentId, room: currentRoom });
    }
  });

  socket.on("message", (message) => {
    console.error(`\n[${message.agentName || "System"}]: ${message.content}`);
  });

  socket.on("task", (data) => {
    console.error(`\n[Task ${data.type}]: ${data.task.title}`);
  });
}

const server = new Server(
  {
    name: "Symphony-of-One-MCP",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool: Join Room
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
        name: "room_join",
        description:
          "Join a chat room on the central server to collaborate with other agents",
        inputSchema: {
          type: "object",
          properties: {
            roomName: {
              type: "string",
              description: "Name of the room to join",
            },
            agentName: { type: "string", description: "Your agent name" },
            capabilities: {
              type: "object",
              properties: {
                skills: { type: "array", items: { type: "string" } },
                role: { type: "string" },
              },
            },
          },
          required: ["roomName", "agentName"],
        },
      },
      {
        name: "room_send",
        description: "Send a message to all agents in the current room",
        inputSchema: {
          type: "object",
          properties: {
            content: { type: "string", description: "Message content" },
            metadata: {
              type: "object",
              properties: {
                type: { type: "string" },
                priority: { type: "string" },
              },
            },
          },
          required: ["content"],
        },
      },
      {
        name: "room_history",
        description: "Get recent messages from current room",
        inputSchema: {
          type: "object",
          properties: {
            since: { type: "string", description: "ISO timestamp" },
            limit: { type: "number", default: 50 },
          },
        },
      },
      {
        name: "room_list",
        description: "List all active rooms and their participants",
        inputSchema: { type: "object" },
      },
      {
        name: "room_leave",
        description: "Leave the current room",
        inputSchema: { type: "object" },
      },
      {
        name: "task_create",
        description: "Create a task in the current room for coordination",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            assignee: { type: "string" },
            priority: { type: "string", enum: ["low", "medium", "high"] },
          },
          required: ["title", "description"],
        },
      },
      {
        name: "task_list",
        description: "List tasks in the current room",
        inputSchema: { type: "object" },
      },
    ],
  };
});

server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "room_join":
      return await handleRoomJoin(args);
    case "room_send":
      return await handleRoomSend(args);
    case "room_history":
      return await handleRoomHistory(args);
    case "room_list":
      return await handleRoomList(args);
    case "room_leave":
      return await handleRoomLeave(args);
    case "task_create":
      return await handleTaskCreate(args);
    case "task_list":
      return await handleTaskList(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function handleRoomJoin(params) {
  try {
    currentAgentId = uuidv4();
    currentRoom = params.roomName;

    const response = await axios.post(
      `${SERVER_URL}/api/join/${params.roomName}`,
      {
        agentId: currentAgentId,
        agentName: params.agentName,
        capabilities: params.capabilities || {},
      }
    );

    connectSocket();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response.data, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: false, error: error.message }),
        },
      ],
    };
  }
}

// Tool: Send Message
server.tool(
  "room_send",
  {
    description: "Send a message to the current room",
    inputSchema: z.object({
      content: z.string().describe("Message content"),
      metadata: z
        .object({
          type: z.string().optional(),
          priority: z.string().optional(),
        })
        .optional(),
    }),
  },
  async (params) => {
    try {
      if (!currentAgentId) {
        throw new Error("Not connected to a room. Use room_join first.");
      }

      const response = await axios.post(`${SERVER_URL}/api/send`, {
        agentId: currentAgentId,
        content: params.content,
        metadata: params.metadata || {},
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }
  }
);

// Tool: Get Messages
server.tool(
  "room_history",
  {
    description: "Get recent messages from current room",
    inputSchema: z.object({
      since: z.string().optional().describe("ISO timestamp"),
      limit: z.number().optional().default(50),
    }),
  },
  async (params) => {
    try {
      if (!currentRoom) {
        throw new Error("Not in a room. Use room_join first.");
      }

      const response = await axios.get(
        `${SERVER_URL}/api/messages/${currentRoom}`,
        {
          params: {
            since: params.since,
            limit: params.limit,
          },
        }
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }
  }
);

// Tool: List Rooms
server.tool(
  "room_list",
  {
    description: "List all active rooms",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const response = await axios.get(`${SERVER_URL}/api/rooms`);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }
  }
);

// Tool: Leave Room
server.tool(
  "room_leave",
  {
    description: "Leave the current room",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      if (!currentAgentId) {
        throw new Error("Not in a room.");
      }

      const response = await axios.post(
        `${SERVER_URL}/api/leave/${currentAgentId}`
      );

      if (socket) {
        socket.disconnect();
        socket = null;
      }

      currentAgentId = null;
      currentRoom = null;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }
  }
);

// Tool: Create Task
server.tool(
  "task_create",
  {
    description: "Create a task in the current room",
    inputSchema: z.object({
      title: z.string(),
      description: z.string(),
      assignee: z.string().optional(),
      priority: z.enum(["low", "medium", "high"]).optional(),
    }),
  },
  async (params) => {
    try {
      if (!currentRoom) {
        throw new Error("Not in a room. Use room_join first.");
      }

      const agent = await axios.get(`${SERVER_URL}/api/agents/${currentRoom}`);
      const currentAgent = agent.data.agents.find(
        (a) => a.id === currentAgentId
      );

      const response = await axios.post(`${SERVER_URL}/api/tasks`, {
        roomName: currentRoom,
        title: params.title,
        description: params.description,
        assignee: params.assignee,
        creator: currentAgent?.name || "Unknown",
        priority: params.priority || "medium",
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }
  }
);

// Tool: List Tasks
server.tool(
  "task_list",
  {
    description: "List tasks in the current room",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      if (!currentRoom) {
        throw new Error("Not in a room. Use room_join first.");
      }

      const response = await axios.get(
        `${SERVER_URL}/api/tasks/${currentRoom}`
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response.data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: false, error: error.message }),
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`MCP Gateway Client connected to server at ${SERVER_URL}`);
}

main().catch(console.error);
