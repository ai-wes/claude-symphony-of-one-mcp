#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import axios from 'axios';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = process.env.CHAT_SERVER_URL || 'http://localhost:3000';
const SHARED_DIR = process.env.SHARED_DIR || path.join(process.cwd(), 'shared');

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
  
  socket.on('connect', () => {
    console.error(`[${agentName}] Connected to chat server at ${SERVER_URL}`);
    if (currentAgentId && currentRoom) {
      socket.emit('register', { agentId: currentAgentId, room: currentRoom });
    }
  });
  
  socket.on('message', (message) => {
    messageHistory.push(message);
    // Keep only last 1000 messages
    if (messageHistory.length > 1000) {
      messageHistory = messageHistory.slice(-1000);
    }
    
    // Check for notifications
    const content = message.content?.toLowerCase() || '';
    if (message.mentions?.includes(agentName)) {
      notifications.push({
        id: uuidv4(),
        type: 'mention',
        message: message,
        timestamp: new Date().toISOString(),
        read: false
      });
    }
    
    for (const pattern of watchPatterns) {
      if (content.includes(pattern.toLowerCase())) {
        notifications.push({
          id: uuidv4(),
          type: 'keyword',
          pattern: pattern,
          message: message,
          timestamp: new Date().toISOString(),
          read: false
        });
        break;
      }
    }
    
    console.error(`[${message.agentName || 'System'}]: ${message.content}`);
  });
  
  socket.on('notification', (notification) => {
    notifications.push({
      id: uuidv4(),
      type: 'system',
      ...notification,
      timestamp: new Date().toISOString(),
      read: false
    });
    console.error(`🔔 [Notification]: ${notification.message}`);
  });
  
  socket.on('task_assigned', (task) => {
    notifications.push({
      id: uuidv4(),
      type: 'task',
      task: task,
      message: `Task assigned: ${task.title}`,
      timestamp: new Date().toISOString(),
      read: false
    });
    console.error(`📋 [Task Assigned]: ${task.title}`);
  });
  
  socket.on('disconnect', () => {
    console.error(`[${agentName}] Disconnected from chat server`);
  });
}

const server = new Server(
  {
    name: 'symphony-of-one-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
async function joinRoom(params) {
  currentAgentId = uuidv4();
  currentRoom = params.roomName;
  if (params.agentName) {
    agentName = params.agentName;
  }
  
  try {
    const response = await axios.post(`${SERVER_URL}/api/join/${params.roomName}`, {
      agentId: currentAgentId,
      agentName: agentName,
      capabilities: params.capabilities || { role: 'ai-agent', type: 'claude' }
    });
    
    connectSocket();
    
    return {
      success: true,
      roomName: params.roomName,
      agentId: currentAgentId,
      agentName: agentName,
      currentAgents: response.data.currentAgents
    };
  } catch (error) {
    throw new Error(`Failed to join room: ${error.message}`);
  }
}

async function leaveRoom() {
  if (!currentAgentId) {
    throw new Error('Not connected to a room');
  }
  
  try {
    await axios.post(`${SERVER_URL}/api/leave`, {
      agentId: currentAgentId
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
      success: true,
      message: `Left room "${leftRoom}"`
    };
  } catch (error) {
    throw new Error(`Failed to leave room: ${error.message}`);
  }
}

async function sendMessage(params) {
  if (!currentAgentId) {
    throw new Error('Not connected to a room. Use room_join first.');
  }
  
  try {
    await axios.post(`${SERVER_URL}/api/send`, {
      agentId: currentAgentId,
      content: params.content,
      metadata: params.metadata || {}
    });
    
    return {
      success: true,
      message: `Message sent to room "${currentRoom}"`
    };
  } catch (error) {
    throw new Error(`Failed to send message: ${error.message}`);
  }
}

async function getMessages(params) {
  if (!currentRoom) {
    throw new Error('Not in a room. Use room_join first.');
  }
  
  try {
    // First try to get from local history
    if (!params.since && messageHistory.length > 0) {
      const limit = params.limit || 50;
      return {
        messages: messageHistory.slice(-limit),
        source: 'local_cache'
      };
    }
    
    // Otherwise fetch from server
    const response = await axios.get(`${SERVER_URL}/api/messages/${currentRoom}`, {
      params: {
        since: params.since,
        limit: params.limit || 50
      }
    });
    
    return {
      messages: response.data.messages,
      source: 'server'
    };
  } catch (error) {
    throw new Error(`Failed to get messages: ${error.message}`);
  }
}

async function searchMessages(params) {
  if (!currentRoom) {
    throw new Error('Not in a room. Use room_join first.');
  }
  
  try {
    const response = await axios.get(`${SERVER_URL}/api/messages/${currentRoom}/search`, {
      params: {
        query: params.query,
        agentName: params.agentName,
        type: params.type,
        mentioned: params.mentioned
      }
    });
    
    return {
      messages: response.data.messages,
      count: response.data.messages.length
    };
  } catch (error) {
    throw new Error(`Failed to search messages: ${error.message}`);
  }
}

async function subscribeToAlerts(params) {
  if (!currentAgentId) {
    throw new Error('Not connected to a room. Use room_join first.');
  }
  
  // Add patterns to watch list
  if (params.patterns) {
    watchPatterns = [...new Set([...watchPatterns, ...params.patterns])];
  }
  
  // Subscribe to mentions
  if (params.mentions !== false) {
    // Mentions are automatically tracked
  }
  
  return {
    success: true,
    watchPatterns: watchPatterns,
    mentionsEnabled: params.mentions !== false
  };
}

async function getNotifications(params) {
  if (!currentAgentId) {
    throw new Error('Not connected to a room. Use room_join first.');
  }
  
  let filtered = notifications;
  
  if (params.unreadOnly) {
    filtered = filtered.filter(n => !n.read);
  }
  
  if (params.type) {
    filtered = filtered.filter(n => n.type === params.type);
  }
  
  return {
    notifications: filtered,
    unreadCount: notifications.filter(n => !n.read).length
  };
}

async function markNotificationRead(params) {
  const notification = notifications.find(n => n.id === params.notificationId);
  
  if (!notification) {
    throw new Error('Notification not found');
  }
  
  notification.read = true;
  
  return {
    success: true,
    notificationId: params.notificationId
  };
}

async function markAllNotificationsRead() {
  let count = 0;
  notifications.forEach(n => {
    if (!n.read) {
      n.read = true;
      count++;
    }
  });
  
  return {
    success: true,
    markedCount: count
  };
}

async function getTasks(params) {
  if (!currentRoom) {
    throw new Error('Not in a room. Use room_join first.');
  }
  
  try {
    const response = await axios.get(`${SERVER_URL}/api/tasks/${currentRoom}`, {
      params: {
        status: params.status,
        assignee: params.assignee || agentName,
        priority: params.priority
      }
    });
    
    return {
      tasks: response.data.tasks
    };
  } catch (error) {
    throw new Error(`Failed to get tasks: ${error.message}`);
  }
}

async function createTask(params) {
  if (!currentRoom) {
    throw new Error('Not in a room. Use room_join first.');
  }
  
  try {
    const response = await axios.post(`${SERVER_URL}/api/tasks/${currentRoom}`, {
      title: params.title,
      description: params.description,
      assignee: params.assignee,
      priority: params.priority || 'medium',
      creator: agentName
    });
    
    return {
      success: true,
      task: response.data.task
    };
  } catch (error) {
    throw new Error(`Failed to create task: ${error.message}`);
  }
}

async function updateTask(params) {
  try {
    const response = await axios.put(`${SERVER_URL}/api/tasks/${params.taskId}`, {
      status: params.status,
      progress: params.progress,
      assignee: params.assignee,
      priority: params.priority
    });
    
    return {
      success: true,
      task: response.data.task
    };
  } catch (error) {
    throw new Error(`Failed to update task: ${error.message}`);
  }
}

async function addTaskComment(params) {
  try {
    const response = await axios.post(`${SERVER_URL}/api/tasks/${params.taskId}/comments`, {
      content: params.content,
      author: agentName
    });
    
    return {
      success: true,
      comment: response.data.comment
    };
  } catch (error) {
    throw new Error(`Failed to add comment: ${error.message}`);
  }
}

async function getRoomAgents() {
  if (!currentRoom) {
    throw new Error('Not in a room. Use room_join first.');
  }
  
  try {
    const response = await axios.get(`${SERVER_URL}/api/rooms/${currentRoom}/agents`);
    
    return {
      agents: response.data.agents,
      room: currentRoom
    };
  } catch (error) {
    throw new Error(`Failed to get room agents: ${error.message}`);
  }
}

async function updateStatus(params) {
  if (!currentAgentId) {
    throw new Error('Not connected to a room. Use room_join first.');
  }
  
  try {
    await axios.put(`${SERVER_URL}/api/agents/${currentAgentId}/status`, {
      status: params.status,
      message: params.message
    });
    
    return {
      success: true,
      status: params.status
    };
  } catch (error) {
    throw new Error(`Failed to update status: ${error.message}`);
  }
}

async function storeMemory(params) {
  if (!currentAgentId) {
    throw new Error('Not connected to a room. Use room_join first.');
  }
  
  try {
    await axios.post(`${SERVER_URL}/api/memory/${currentAgentId}`, {
      key: params.key,
      value: params.value,
      type: params.type || 'note',
      expiresIn: params.expiresIn
    });
    
    return {
      success: true,
      key: params.key
    };
  } catch (error) {
    throw new Error(`Failed to store memory: ${error.message}`);
  }
}

async function retrieveMemory(params) {
  if (!currentAgentId) {
    throw new Error('Not connected to a room. Use room_join first.');
  }
  
  try {
    const queryParams = new URLSearchParams();
    if (params.key) queryParams.append('key', params.key);
    if (params.type) queryParams.append('type', params.type);
    
    const response = await axios.get(`${SERVER_URL}/api/memory/${currentAgentId}?${queryParams}`);
    
    return {
      memories: response.data.memories
    };
  } catch (error) {
    throw new Error(`Failed to retrieve memory: ${error.message}`);
  }
}

// Tool definitions
const tools = [
  {
    name: 'room_join',
    description: 'Join a chat room to collaborate with other agents',
    inputSchema: {
      type: 'object',
      properties: {
        roomName: { type: 'string', description: 'Name of the room to join' },
        agentName: { type: 'string', description: 'Your agent name (optional)' },
        capabilities: {
          type: 'object',
          description: 'Your capabilities and role',
          properties: {
            skills: { type: 'array', items: { type: 'string' } },
            role: { type: 'string' },
            expertise: { type: 'string' }
          }
        }
      },
      required: ['roomName']
    },
    handler: joinRoom
  },
  {
    name: 'room_leave',
    description: 'Leave the current chat room',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: leaveRoom
  },
  {
    name: 'send_message',
    description: 'Send a message to all agents in the current room (supports @mentions)',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Message content' },
        metadata: {
          type: 'object',
          description: 'Optional metadata',
          properties: {
            type: { type: 'string', enum: ['code', 'documentation', 'question', 'answer', 'task'] },
            language: { type: 'string' },
            urgency: { type: 'string', enum: ['low', 'normal', 'high'] }
          }
        }
      },
      required: ['content']
    },
    handler: sendMessage
  },
  {
    name: 'get_messages',
    description: 'Get recent messages from current room',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'ISO timestamp to get messages after' },
        limit: { type: 'number', description: 'Maximum number of messages (default: 50)' }
      }
    },
    handler: getMessages
  },
  {
    name: 'search_messages',
    description: 'Search messages in the current room',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        agentName: { type: 'string', description: 'Filter by agent name' },
        type: { type: 'string', description: 'Filter by message type' },
        mentioned: { type: 'string', description: 'Find messages mentioning this agent' }
      },
      required: ['query']
    },
    handler: searchMessages
  },
  {
    name: 'subscribe_alerts',
    description: 'Subscribe to alerts for mentions and keywords',
    inputSchema: {
      type: 'object',
      properties: {
        patterns: { 
          type: 'array', 
          items: { type: 'string' },
          description: 'Keywords to watch for'
        },
        mentions: { type: 'boolean', description: 'Subscribe to @mentions (default: true)' }
      }
    },
    handler: subscribeToAlerts
  },
  {
    name: 'get_notifications',
    description: 'Get your notifications',
    inputSchema: {
      type: 'object',
      properties: {
        unreadOnly: { type: 'boolean', description: 'Only return unread notifications' },
        type: { 
          type: 'string', 
          enum: ['mention', 'keyword', 'task', 'system'],
          description: 'Filter by notification type' 
        }
      }
    },
    handler: getNotifications
  },
  {
    name: 'mark_notification_read',
    description: 'Mark a notification as read',
    inputSchema: {
      type: 'object',
      properties: {
        notificationId: { type: 'string', description: 'ID of notification to mark as read' }
      },
      required: ['notificationId']
    },
    handler: markNotificationRead
  },
  {
    name: 'mark_all_notifications_read',
    description: 'Mark all notifications as read',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: markAllNotificationsRead
  },
  {
    name: 'get_tasks',
    description: 'Get tasks assigned to you or in the room',
    inputSchema: {
      type: 'object',
      properties: {
        status: { 
          type: 'string', 
          enum: ['todo', 'in_progress', 'review', 'done', 'blocked'],
          description: 'Filter by status' 
        },
        assignee: { type: 'string', description: 'Filter by assignee (defaults to you)' },
        priority: { 
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Filter by priority'
        }
      }
    },
    handler: getTasks
  },
  {
    name: 'create_task',
    description: 'Create a new task',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        assignee: { type: 'string', description: 'Agent to assign to' },
        priority: { 
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Task priority (default: medium)'
        }
      },
      required: ['title', 'description']
    },
    handler: createTask
  },
  {
    name: 'update_task',
    description: 'Update a task status or details',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        status: { 
          type: 'string',
          enum: ['todo', 'in_progress', 'review', 'done', 'blocked']
        },
        progress: { type: 'number', description: 'Progress percentage (0-100)' },
        assignee: { type: 'string', description: 'New assignee' },
        priority: { 
          type: 'string',
          enum: ['low', 'medium', 'high']
        }
      },
      required: ['taskId']
    },
    handler: updateTask
  },
  {
    name: 'add_task_comment',
    description: 'Add a comment to a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID' },
        content: { type: 'string', description: 'Comment content' }
      },
      required: ['taskId', 'content']
    },
    handler: addTaskComment
  },
  {
    name: 'get_room_agents',
    description: 'Get list of agents in current room',
    inputSchema: {
      type: 'object',
      properties: {}
    },
    handler: getRoomAgents
  },
  {
    name: 'update_status',
    description: 'Update your agent status',
    inputSchema: {
      type: 'object',
      properties: {
        status: { 
          type: 'string',
          enum: ['online', 'busy', 'away', 'offline'],
          description: 'Your status'
        },
        message: { type: 'string', description: 'Optional status message' }
      },
      required: ['status']
    },
    handler: updateStatus
  },
  {
    name: 'memory_store',
    description: 'Store information in persistent memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        value: { type: 'string', description: 'Memory value' },
        type: { type: 'string', description: 'Memory type (e.g., note, context, learning)' },
        expiresIn: { type: 'number', description: 'Expiration time in seconds (optional)' }
      },
      required: ['key', 'value']
    },
    handler: storeMemory
  },
  {
    name: 'memory_retrieve',
    description: 'Retrieve information from persistent memory',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key (optional, returns all if not specified)' },
        type: { type: 'string', description: 'Filter by memory type' }
      }
    },
    handler: retrieveMemory
  }
];

// Register all tools
tools.forEach(tool => {
  server.registerTool(tool.name, tool.description, tool.inputSchema, tool.handler);
});

// Start the server
async function main() {
  await ensureSharedDir();
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  
  console.error(`Symphony of One MCP Server v1.0.0 - Agent Communication Tools`);
  console.error(`Hub Server: ${SERVER_URL}`);
  console.error(`Agent Name: ${agentName}`);
}

main().catch(console.error);