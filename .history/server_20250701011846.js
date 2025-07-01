#!/usr/bin/env node
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import chokidar from 'chokidar';
import sqlite3 from 'sqlite3';
import winston from 'winston';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Configuration
const SHARED_DIR = process.env.SHARED_DIR || path.join(process.cwd(), 'shared');
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');

// Logging setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'symphony-of-one-hub' },
  transports: [
    new winston.transports.File({ filename: path.join(DATA_DIR, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(DATA_DIR, 'combined.log') }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Database setup
const db = new sqlite3.Database(path.join(DATA_DIR, 'symphony-of-one.db'));

// In-memory storage (with database persistence)
const rooms = new Map();
const agents = new Map();
const messages = new Map();
const tasks = new Map();
const fileWatcher = new Map();
const agentMemory = new Map(); // Persistent agent memories

// Initialize directories and database
async function initializeSystem() {
  try {
    await fs.access(SHARED_DIR);
  } catch {
    await fs.mkdir(SHARED_DIR, { recursive: true });
    logger.info(`Created shared directory: ${SHARED_DIR}`);
  }
  
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
    logger.info(`Created data directory: ${DATA_DIR}`);
  }
  
  // Initialize database tables
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT 1,
      settings TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      room TEXT,
      capabilities TEXT,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active'
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      room TEXT,
      agent_id TEXT,
      agent_name TEXT,
      content TEXT,
      type TEXT DEFAULT 'message',
      mentions TEXT,
      metadata TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      room TEXT,
      title TEXT,
      description TEXT,
      assignee TEXT,
      creator TEXT,
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'todo',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      room TEXT,
      key TEXT,
      value TEXT,
      type TEXT DEFAULT 'note',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      room TEXT,
      message TEXT,
      type TEXT DEFAULT 'mention',
      is_read BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
  
  // Load existing data into memory
  await loadDataFromDatabase();
}

// Load data from database into memory maps
async function loadDataFromDatabase() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM rooms WHERE is_active = 1", (err, rows) => {
      if (err) {
        logger.error('Failed to load rooms from database:', err);
        return reject(err);
      }
      
      rows.forEach(row => {
        rooms.set(row.name, {
          name: row.name,
          agents: new Set(),
          createdAt: row.created_at,
          isActive: row.is_active === 1,
          settings: row.settings ? JSON.parse(row.settings) : {}
        });
        messages.set(row.name, []);
      });
      
      logger.info(`Loaded ${rows.length} rooms from database`);
      resolve();
    });
  });
}

// Parse mentions from message content (@agentName)
function parseMentions(content) {
  const mentionRegex = /@(\w+(?:-\w+)*)/g;
  const mentions = [];
  let match;
  
  while ((match = mentionRegex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return mentions;
}

// Create notifications for mentioned agents
async function createNotifications(message, mentions) {
  const notifications = mentions.map(agentName => ({
    id: uuidv4(),
    agent_id: findAgentByName(agentName)?.id,
    room: message.room,
    message: `${message.agentName} mentioned you: ${message.content.substring(0, 100)}...`,
    type: 'mention',
    created_at: new Date().toISOString()
  })).filter(n => n.agent_id); // Only create notifications for existing agents
  
  notifications.forEach(notification => {
    db.run(
      "INSERT INTO notifications (id, agent_id, room, message, type, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [notification.id, notification.agent_id, notification.room, notification.message, notification.type, notification.created_at]
    );
    
    // Send real-time notification to agent if connected
    const agent = agents.get(notification.agent_id);
    if (agent && agent.socketId) {
      io.to(agent.socketId).emit('notification', notification);
    }
  });
  
  return notifications;
}

// Find agent by name in current agents
function findAgentByName(agentName) {
  for (const agent of agents.values()) {
    if (agent.name === agentName) {
      return agent;
    }
  }
  return null;
}

// Setup file watcher for a room
function setupFileWatcher(roomName) {
  if (fileWatcher.has(roomName)) return;
  
  const watcher = chokidar.watch(SHARED_DIR, {
    ignored: /[\/\\]\./,
    persistent: true
  });
  
  watcher.on('change', (filePath) => {
    const relativePath = path.relative(SHARED_DIR, filePath);
    const message = {
      id: uuidv4(),
      type: 'file_change',
      content: `File modified: ${relativePath}`,
      timestamp: new Date().toISOString(),
      room: roomName,
      metadata: { filePath: relativePath, action: 'change' }
    };
    
    messages.get(roomName)?.push(message);
    io.to(roomName).emit('message', message);
  });
  
  watcher.on('add', (filePath) => {
    const relativePath = path.relative(SHARED_DIR, filePath);
    const message = {
      id: uuidv4(),
      type: 'file_change',
      content: `File created: ${relativePath}`,
      timestamp: new Date().toISOString(),
      room: roomName,
      metadata: { filePath: relativePath, action: 'add' }
    };
    
    messages.get(roomName)?.push(message);
    io.to(roomName).emit('message', message);
  });
  
  watcher.on('unlink', (filePath) => {
    const relativePath = path.relative(SHARED_DIR, filePath);
    const message = {
      id: uuidv4(),
      type: 'file_change',
      content: `File deleted: ${relativePath}`,
      timestamp: new Date().toISOString(),
      room: roomName,
      metadata: { filePath: relativePath, action: 'delete' }
    };
    
    messages.get(roomName)?.push(message);
    io.to(roomName).emit('message', message);
  });
  
  fileWatcher.set(roomName, watcher);
}

// Room management
function getRoom(roomName) {
  if (!rooms.has(roomName)) {
    const room = {
      name: roomName,
      agents: new Set(),
      createdAt: new Date().toISOString(),
      isActive: true,
      settings: {}
    };
    rooms.set(roomName, room);
    messages.set(roomName, []);
    setupFileWatcher(roomName);
    
    // Persist to database
    db.run(
      "INSERT OR REPLACE INTO rooms (id, name, created_at, is_active, settings) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), roomName, room.createdAt, 1, JSON.stringify(room.settings)]
    );
    
    logger.info(`Created new room: ${roomName}`);
  }
  return rooms.get(roomName);
}

// HTTP API Endpoints
app.post('/api/join/:room', (req, res) => {
  const { room: roomName } = req.params;
  const { agentId, agentName, capabilities = {} } = req.body;
  
  const room = getRoom(roomName);
  room.agents.add(agentId);
  
  const agent = {
    id: agentId,
    name: agentName,
    room: roomName,
    capabilities,
    joinedAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    socketId: null,
    status: 'active'
  };
  
  agents.set(agentId, agent);
  
  // Persist agent to database
  db.run(
    "INSERT OR REPLACE INTO agents (id, name, room, capabilities, joined_at, last_active, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [agentId, agentName, roomName, JSON.stringify(capabilities), agent.joinedAt, agent.lastActive, agent.status]
  );
  
  const joinMessage = {
    id: uuidv4(),
    type: 'system',
    agentId: null,
    agentName: 'System',
    content: `${agentName} has joined the room`,
    timestamp: new Date().toISOString(),
    room: roomName,
    mentions: [],
    metadata: { type: 'join' }
  };
  
  messages.get(roomName).push(joinMessage);
  
  // Persist message to database
  db.run(
    "INSERT INTO messages (id, room, agent_id, agent_name, content, type, mentions, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [joinMessage.id, roomName, null, 'System', joinMessage.content, joinMessage.type, JSON.stringify(joinMessage.mentions), JSON.stringify(joinMessage.metadata), joinMessage.timestamp]
  );
  
  io.to(roomName).emit('message', joinMessage);
  
  logger.info(`Agent ${agentName} (${agentId}) joined room ${roomName}`);
  
  res.json({
    success: true,
    roomName,
    agentId,
    currentAgents: Array.from(room.agents).map(id => agents.get(id))
  });
});

app.post('/api/leave/:agentId', (req, res) => {
  const { agentId } = req.params;
  const agent = agents.get(agentId);
  
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  
  const room = rooms.get(agent.room);
  if (room) {
    room.agents.delete(agentId);
    
    const leaveMessage = {
      id: uuidv4(),
      type: 'system',
      content: `${agent.name} has left the room`,
      timestamp: new Date().toISOString(),
      room: agent.room
    };
    
    messages.get(agent.room).push(leaveMessage);
    io.to(agent.room).emit('message', leaveMessage);
  }
  
  agents.delete(agentId);
  res.json({ success: true });
});

app.post('/api/send', (req, res) => {
  const { agentId, content, metadata = {} } = req.body;
  const agent = agents.get(agentId);
  
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  
  // Parse mentions from content
  const mentions = parseMentions(content);
  
  const message = {
    id: uuidv4(),
    type: 'message',
    agentId,
    agentName: agent.name,
    content,
    mentions,
    metadata,
    timestamp: new Date().toISOString(),
    room: agent.room
  };
  
  messages.get(agent.room).push(message);
  
  // Persist message to database
  db.run(
    "INSERT INTO messages (id, room, agent_id, agent_name, content, type, mentions, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [message.id, agent.room, agentId, agent.name, content, message.type, JSON.stringify(mentions), JSON.stringify(metadata), message.timestamp]
  );
  
  // Update agent last active time
  agent.lastActive = new Date().toISOString();
  db.run("UPDATE agents SET last_active = ? WHERE id = ?", [agent.lastActive, agentId]);
  
  // Create notifications for mentions
  if (mentions.length > 0) {
    createNotifications(message, mentions);
  }
  
  io.to(agent.room).emit('message', message);
  
  logger.info(`Message sent by ${agent.name} in ${agent.room}${mentions.length > 0 ? ` with mentions: ${mentions.join(', ')}` : ''}`);
  
  res.json({ success: true, messageId: message.id, mentions });
});

app.get('/api/messages/:room', (req, res) => {
  const { room } = req.params;
  const { since, limit = 100 } = req.query;
  
  let roomMessages = messages.get(room) || [];
  
  if (since) {
    const sinceTime = new Date(since).getTime();
    roomMessages = roomMessages.filter(m => 
      new Date(m.timestamp).getTime() > sinceTime
    );
  }
  
  res.json({
    messages: roomMessages.slice(-parseInt(limit))
  });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([name, room]) => ({
    name,
    agentCount: room.agents.size,
    agents: Array.from(room.agents).map(id => agents.get(id)).filter(Boolean),
    createdAt: room.createdAt
  }));
  
  res.json({ rooms: roomList });
});

app.get('/api/agents/:room', (req, res) => {
  const { room: roomName } = req.params;
  const room = rooms.get(roomName);
  
  if (!room) {
    return res.status(404).json({ success: false, error: 'Room not found' });
  }
  
  const roomAgents = Array.from(room.agents)
    .map(id => agents.get(id))
    .filter(Boolean);
  
  res.json({ agents: roomAgents });
});

// Task endpoints
app.post('/api/tasks', (req, res) => {
  const { roomName, title, description, assignee, creator, priority = 'medium' } = req.body;
  
  const task = {
    id: uuidv4(),
    room: roomName,
    title,
    description,
    assignee,
    creator,
    priority,
    status: 'todo',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  tasks.set(task.id, task);
  io.to(roomName).emit('task', { type: 'created', task });
  
  res.json({ success: true, task });
});

app.get('/api/tasks/:room', (req, res) => {
  const { room } = req.params;
  const roomTasks = Array.from(tasks.values()).filter(t => t.room === room);
  res.json({ tasks: roomTasks });
});

// Agent management endpoints
app.get('/api/stats', (req, res) => {
  const stats = {
    totalRooms: rooms.size,
    totalAgents: agents.size,
    totalTasks: tasks.size,
    sharedDirectory: SHARED_DIR,
    rooms: Array.from(rooms.entries()).map(([name, room]) => ({
      name,
      agentCount: room.agents.size,
      messageCount: messages.get(name)?.length || 0,
      isActive: room.isActive
    }))
  };
  res.json(stats);
});

app.post('/api/broadcast/:room', (req, res) => {
  const { room: roomName } = req.params;
  const { content, from = 'Orchestrator' } = req.body;
  
  const message = {
    id: uuidv4(),
    type: 'broadcast',
    content: `[${from}] ${content}`,
    timestamp: new Date().toISOString(),
    room: roomName,
    from
  };
  
  messages.get(roomName)?.push(message);
  io.to(roomName).emit('message', message);
  
  res.json({ success: true, messageId: message.id });
});

app.post('/api/tasks/:taskId/update', (req, res) => {
  const { taskId } = req.params;
  const { status, assignee, priority } = req.body;
  
  const task = tasks.get(taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }
  
  if (status) task.status = status;
  if (assignee) task.assignee = assignee;
  if (priority) task.priority = priority;
  task.updatedAt = new Date().toISOString();
  
  // Update in database
  db.run(
    "UPDATE tasks SET status = ?, assignee = ?, priority = ?, updated_at = ? WHERE id = ?",
    [task.status, task.assignee, task.priority, task.updatedAt, taskId]
  );
  
  io.to(task.room).emit('task', { type: 'updated', task });
  
  logger.info(`Task ${taskId} updated: status=${task.status}, assignee=${task.assignee}`);
  
  res.json({ success: true, task });
});

// Agent memory endpoints
app.post('/api/memory/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { key, value, type = 'note', expiresIn } = req.body;
  
  const agent = agents.get(agentId);
  if (!agent) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  
  const memoryId = uuidv4();
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  
  const memory = {
    id: memoryId,
    agentId,
    room: agent.room,
    key,
    value,
    type,
    createdAt: new Date().toISOString(),
    expiresAt
  };
  
  // Store in database
  db.run(
    "INSERT INTO agent_memory (id, agent_id, room, key, value, type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [memoryId, agentId, agent.room, key, value, type, memory.createdAt, expiresAt]
  );
  
  logger.info(`Memory stored for agent ${agent.name}: ${key}`);
  
  res.json({ success: true, memoryId, memory });
});

app.get('/api/memory/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { key, type } = req.query;
  
  let query = "SELECT * FROM agent_memory WHERE agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))";
  const params = [agentId];
  
  if (key) {
    query += " AND key = ?";
    params.push(key);
  }
  
  if (type) {
    query += " AND type = ?";
    params.push(type);
  }
  
  query += " ORDER BY created_at DESC";
  
  db.all(query, params, (err, rows) => {
    if (err) {
      logger.error('Failed to retrieve agent memory:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, memories: rows });
  });
});

app.get('/api/notifications/:agentId', (req, res) => {
  const { agentId } = req.params;
  const { unreadOnly = false } = req.query;
  
  let query = "SELECT * FROM notifications WHERE agent_id = ?";
  const params = [agentId];
  
  if (unreadOnly === 'true') {
    query += " AND is_read = 0";
  }
  
  query += " ORDER BY created_at DESC LIMIT 50";
  
  db.all(query, params, (err, rows) => {
    if (err) {
      logger.error('Failed to retrieve notifications:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, notifications: rows });
  });
});

app.post('/api/notifications/:notificationId/read', (req, res) => {
  const { notificationId } = req.params;
  
  db.run("UPDATE notifications SET is_read = 1 WHERE id = ?", [notificationId], function(err) {
    if (err) {
      logger.error('Failed to mark notification as read:', err);
      return res.status(500).json({ success: false, error: 'Database error' });
    }
    
    res.json({ success: true, updated: this.changes > 0 });
  });
});

// WebSocket handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('register', ({ agentId, room }) => {
    const agent = agents.get(agentId);
    if (agent) {
      agent.socketId = socket.id;
      socket.join(room);
      console.log(`Agent ${agent.name} registered with socket ${socket.id}`);
    }
  });
  
  socket.on('message', (data) => {
    if (data.room) {
      io.to(data.room).emit('message', data);
    }
  });
  
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

async function startServer() {
  await initializeSystem();
  
  httpServer.listen(PORT, () => {
    logger.info(`Claude Gateway Hub started on port ${PORT}`);
    console.log(`🚀 Claude Gateway Hub running on http://localhost:${PORT}`);
    console.log(`📁 Shared Directory: ${SHARED_DIR}`);
    console.log(`💾 Data Directory: ${DATA_DIR}`);
    console.log(`\nCore Endpoints:`);
    console.log(`  POST   /api/join/:room         - Join a room`);
    console.log(`  POST   /api/leave/:agentId     - Leave current room`);
    console.log(`  POST   /api/send               - Send a message`);
    console.log(`  GET    /api/messages/:room     - Get room messages`);
    console.log(`  GET    /api/rooms              - List all rooms`);
    console.log(`  GET    /api/agents/:room       - Get room agents`);
    console.log(`\nTask Management:`);
    console.log(`  POST   /api/tasks              - Create a task`);
    console.log(`  GET    /api/tasks/:room        - Get room tasks`);
    console.log(`  POST   /api/tasks/:id/update   - Update task status`);
    console.log(`\nAgent Memory & Notifications:`);
    console.log(`  POST   /api/memory/:agentId    - Store agent memory`);
    console.log(`  GET    /api/memory/:agentId    - Retrieve agent memory`);
    console.log(`  GET    /api/notifications/:id  - Get notifications`);
    console.log(`  POST   /api/notifications/:id/read - Mark as read`);
    console.log(`\nOrchestration:`);
    console.log(`  GET    /api/stats              - Get system stats`);
    console.log(`  POST   /api/broadcast/:room    - Broadcast to room`);
    console.log(`\nFeatures:`);
    console.log(`  🏷️  Agent tagging with @mentions`);
    console.log(`  🔔 Real-time notifications`);
    console.log(`  💾 Persistent logging & storage`);
    console.log(`  📝 Agent memory management`);
    console.log(`\nWebSocket Events:`);
    console.log(`  - message: Chat messages & file changes`);
    console.log(`  - task: Task updates`);
    console.log(`  - notification: Mentions & alerts`);
    console.log(`\n🤖 Ready for MCP agent connections!`);
  });
}

startServer().catch(console.error);