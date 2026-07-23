#!/usr/bin/env node
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import fs from "fs/promises";
import path from "path";
import chokidar from "chokidar";
import sqlite3 from "sqlite3";
import winston from "winston";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Socket.IO auth handshake middleware (AUTH_TOKEN resolved after io is created)
// Note: AUTH_TOKEN const is defined below after express.json(); we use
// process.env.AUTH_TOKEN directly here to avoid forward-reference issues.
io.use((socket, next) => {
  const authToken = process.env.AUTH_TOKEN || '';
  if (!authToken) return next();           // open mode
  const token =
    socket.handshake.auth?.token ||
    socket.handshake.headers?.['x-auth-token'] ||
    null;
  if (token === authToken) return next();
  return next(new Error('Unauthorized'));
});

app.use(cors());
app.use(express.json());

// Shared-token auth (gracefully disabled when AUTH_TOKEN is unset)
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// REST middleware: guard /api/* routes
app.use('/api', (req, res, next) => {
  if (!AUTH_TOKEN) return next();          // open mode
  const bearer = req.headers['authorization'];
  const xToken = req.headers['x-auth-token'];
  const provided =
    (bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : null) ||
    xToken ||
    null;
  if (provided === AUTH_TOKEN) return next();
  return res.status(401).json({ success: false, error: 'Unauthorized' });
});

// Configuration
const SHARED_DIR = process.env.SHARED_DIR || path.join(process.cwd(), "shared");
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");

// Logging setup
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "claude-symphony-of-one-hub" },
  transports: [
    new winston.transports.File({
      filename: path.join(DATA_DIR, "error.log"),
      level: "error",
    }),
    new winston.transports.File({
      filename: path.join(DATA_DIR, "combined.log"),
    }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Database setup
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "claude-symphony-of-one.db");
const db = new sqlite3.Database(DB_PATH);

// How many recent messages per room to rehydrate into memory on boot.
// Bounded so a long-lived DB doesn't load unboundedly at startup; older
// messages remain in SQLite and are simply not served by /api/messages.
const MESSAGE_HISTORY_LIMIT = parseInt(
  process.env.MESSAGE_HISTORY_LIMIT || "200",
  10
);

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

  // Schema migrations — run before table creation so columns exist on first boot
  // and are added to existing DBs that predate this column.
  await new Promise((resolve) => {
    db.run("ALTER TABLE notifications ADD COLUMN agent_name TEXT", () => resolve());
  });

  // Initialize database tables — wrapped in a Promise so loadDataFromDatabase
  // only runs after all CREATE TABLE statements have completed.
  await new Promise((resolve, reject) => {
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
        agent_name TEXT,
        room TEXT,
        message TEXT,
        type TEXT DEFAULT 'mention',
        is_read BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) reject(err); else resolve();
      });
    });
  });

  // Load existing data into memory
  await loadDataFromDatabase();
}

/**
 * Fire-and-forget write that at least reports its own failure.
 *
 * sqlite3's db.run() swallows errors entirely when given no callback — no
 * throw, no log — so a failed INSERT was indistinguishable from a successful
 * one. Use this for writes with no caller waiting on the result (heartbeats,
 * side-effect rows). Writes whose success is REPORTED to a caller should pass
 * an explicit callback and gate the response on it instead.
 *
 * @param {string} sql
 * @param {Array} params
 * @param {string} context  Short label for the log line, e.g. "notification insert"
 */
function dbRun(sql, params, context) {
  db.run(sql, params, function (err) {
    if (err) {
      logger.error(`Database write failed (${context}): ${err.message}`);
    }
  });
}

/**
 * Timestamps double as pagination cursors (`?since=<ts>` with a strict `>`),
 * so two messages sharing a millisecond are indistinguishable: whichever falls
 * on a page boundary is skipped forever. Under concurrent load that is common.
 *
 * Guarantee a strictly increasing timestamp per room so the cursor is exact.
 * Skew is at most a few ms and only under bursts.
 */
const lastIssuedTs = new Map();

function nextTimestamp(room) {
  // Reserve SYNCHRONOUSLY from a counter, not from the last element of the
  // messages array: the array is appended inside the DB write callback, so
  // concurrent sends would all read the same stale tail and collide anyway.
  const now = Date.now();
  const prev = lastIssuedTs.get(room) ?? 0;
  const ts = prev >= now ? prev + 1 : now;
  lastIssuedTs.set(room, ts);
  return new Date(ts).toISOString();
}

// Tolerate malformed/NULL JSON columns rather than throwing during boot.
function safeJsonParse(value, fallback) {
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

// Map a `messages` DB row to the in-memory message shape used by
// /api/messages and the socket 'message' event.
function rowToMessage(row) {
  return {
    id: row.id,
    type: row.type || "message",
    agentId: row.agent_id,
    agentName: row.agent_name,
    content: row.content,
    mentions: safeJsonParse(row.mentions, []),
    metadata: safeJsonParse(row.metadata, {}),
    timestamp: row.timestamp,
    room: row.room,
  };
}

/**
 * Rehydrate recent message history from SQLite into the in-memory Map.
 *
 * Messages were previously persisted but never read back, so every restart
 * left /api/messages blind to history that was sitting on disk — and a
 * `since` query spanning a restart returned a truthful-looking empty result.
 */
function loadMessagesForRooms(roomNames) {
  return Promise.all(
    roomNames.map(
      (name) =>
        new Promise((resolve) => {
          db.all(
            "SELECT * FROM messages WHERE room = ? ORDER BY timestamp DESC LIMIT ?",
            [name, MESSAGE_HISTORY_LIMIT],
            (err, rows) => {
              if (err) {
                logger.error(`Failed to load messages for room ${name}:`, err);
                return resolve(0); // leave the [] initializer in place
              }
              // Rows come back newest-first; stored order is chronological
              // ascending, which /api/messages' slice(-limit) depends on.
              const loaded = rows.reverse().map(rowToMessage);
              messages.set(name, loaded);
              // Seed the cursor counter so timestamps stay strictly increasing
              // across a restart, not just within one process lifetime.
              const newest = loaded.at(-1)?.timestamp;
              if (newest) {
                const ms = new Date(newest).getTime();
                if (Number.isFinite(ms)) lastIssuedTs.set(name, ms);
              }
              resolve(rows.length);
            }
          );
        })
    )
  );
}

// Load data from database into memory maps
async function loadDataFromDatabase() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM rooms WHERE is_active = 1", (err, rows) => {
      if (err) {
        logger.error("Failed to load rooms from database:", err);
        return reject(err);
      }

      rows.forEach((row) => {
        rooms.set(row.name, {
          name: row.name,
          agents: new Set(),
          createdAt: row.created_at,
          isActive: row.is_active === 1,
          settings: row.settings ? JSON.parse(row.settings) : {},
        });
        messages.set(row.name, []);
      });

      logger.info(`Loaded ${rows.length} rooms from database`);

      // Bug 3 fix: also load tasks from DB into the tasks Map
      db.all("SELECT * FROM tasks", (taskErr, taskRows) => {
        if (taskErr) {
          logger.error("Failed to load tasks from database:", taskErr);
          // Non-fatal — resolve anyway so the server still starts
          return resolve();
        }
        taskRows.forEach((row) => {
          tasks.set(row.id, {
            id: row.id,
            room: row.room,
            title: row.title,
            description: row.description,
            assignee: row.assignee,
            creator: row.creator,
            priority: row.priority,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          });
        });
        logger.info(`Loaded ${taskRows.length} tasks from database`);

        // Rehydrate agents. Without this every agent is unknown after a
        // restart and /api/send answers 404 "Agent not found" until it
        // happens to re-join — so a deploy silently muted the whole room.
        // socketId is intentionally null: the old socket is gone, so
        // real-time pushes are skipped until the agent reconnects, but
        // REST sends work immediately.
        db.all("SELECT * FROM agents", (agentErr, agentRows) => {
          if (agentErr) {
            logger.error("Failed to load agents from database:", agentErr);
          } else {
            agentRows.forEach((row) => {
              agents.set(row.id, {
                id: row.id,
                name: row.name,
                room: row.room,
                capabilities: safeJsonParse(row.capabilities, {}),
                joinedAt: row.joined_at,
                lastActive: row.last_active,
                status: row.status || "active",
                socketId: null,
              });
              const room = rooms.get(row.room);
              if (room) room.agents.add(row.id);
            });
            logger.info(`Loaded ${agentRows.length} agents from database`);
          }
        });

        // Rehydrate message history so /api/messages survives a restart.
        loadMessagesForRooms(rows.map((r) => r.name))
          .then((counts) => {
            const total = counts.reduce((a, b) => a + b, 0);
            logger.info(
              `Loaded ${total} messages from database across ${rows.length} rooms (limit ${MESSAGE_HISTORY_LIMIT}/room)`
            );
            resolve();
          })
          .catch((msgErr) => {
            logger.error("Failed to load message history:", msgErr);
            resolve(); // non-fatal — server still starts
          });
      });
    });
  });
}

/**
 * Parse @mentions from message content.
 *
 * Separators (`-`, `.`, `_`) are allowed INSIDE a name but never at the end,
 * so "@agent.with.dots" resolves fully while "@agent." at the end of a
 * sentence yields "agent" rather than "agent.". The previous pattern
 * (/@(\w+(?:-\w+)*)/) stopped at the first dot, silently targeting the wrong
 * agent.
 *
 * Results are deduplicated case-insensitively: mentioning the same agent twice
 * in one message previously created two notification rows for one event.
 * The first spelling encountered is preserved.
 */
function parseMentions(content) {
  const mentionRegex = /@([A-Za-z0-9_]+(?:[.\-][A-Za-z0-9_]+)*)/g;
  const mentions = [];
  const seen = new Set();
  let match;

  while ((match = mentionRegex.exec(content)) !== null) {
    const name = match[1];
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    mentions.push(name);
  }

  return mentions;
}

// Create notifications for mentioned agents
async function createNotifications(message, mentions) {
  const notifications = mentions.map((mentionedName) => {
    const agent = findAgentByName(mentionedName);
    return {
      id: uuidv4(),
      agent_id: agent?.id || null,
      agent_name: mentionedName,
      room: message.room,
      message: `${message.agentName} mentioned you: ${message.content.substring(0, 100)}...`,
      type: "mention",
      created_at: new Date().toISOString(),
    };
  });
  // Persist all notifications — even for agents not currently online.
  // Agents joining later will fetch by name from the server.
  notifications.forEach((notification) => {
    dbRun(
      "INSERT INTO notifications (id, agent_id, agent_name, room, message, type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        notification.id,
        notification.agent_id,
        notification.agent_name,
        notification.room,
        notification.message,
        notification.type,
        notification.created_at,
      ],
      `notification insert for ${notification.agent_name}`
    );

    // Also push real-time if agent is currently connected
    if (notification.agent_id) {
      const agent = agents.get(notification.agent_id);
      if (agent && agent.socketId) {
        io.to(agent.socketId).emit("notification", notification);
      }
    }
  });

  return notifications;
}

// Find agent by name — case-insensitive
function findAgentByName(agentName) {
  const lower = agentName.toLowerCase();
  for (const agent of agents.values()) {
    if (agent.name.toLowerCase() === lower) {
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
    persistent: true,
  });

  watcher.on("change", (filePath) => {
    const relativePath = path.relative(SHARED_DIR, filePath);
    const message = {
      id: uuidv4(),
      type: "file_change",
      content: `File modified: ${relativePath}`,
      timestamp: new Date().toISOString(),
      room: roomName,
      metadata: { filePath: relativePath, action: "change" },
    };

    messages.get(roomName)?.push(message);
    io.to(roomName).emit("message", message);
  });

  watcher.on("add", (filePath) => {
    const relativePath = path.relative(SHARED_DIR, filePath);
    const message = {
      id: uuidv4(),
      type: "file_change",
      content: `File created: ${relativePath}`,
      timestamp: new Date().toISOString(),
      room: roomName,
      metadata: { filePath: relativePath, action: "add" },
    };

    messages.get(roomName)?.push(message);
    io.to(roomName).emit("message", message);
  });

  watcher.on("unlink", (filePath) => {
    const relativePath = path.relative(SHARED_DIR, filePath);
    const message = {
      id: uuidv4(),
      type: "file_change",
      content: `File deleted: ${relativePath}`,
      timestamp: new Date().toISOString(),
      room: roomName,
      metadata: { filePath: relativePath, action: "delete" },
    };

    messages.get(roomName)?.push(message);
    io.to(roomName).emit("message", message);
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
      settings: {},
    };
    rooms.set(roomName, room);
    messages.set(roomName, []);
    setupFileWatcher(roomName);

    // Persist to database
    dbRun(
      "INSERT OR REPLACE INTO rooms (id, name, created_at, is_active, settings) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), roomName, room.createdAt, 1, JSON.stringify(room.settings)],
      `room upsert ${roomName}`
    );

    logger.info(`Created new room: ${roomName}`);
  }
  return rooms.get(roomName);
}

// HTTP API Endpoints
app.post("/api/join/:room", (req, res) => {
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
    status: "active",
  };

  agents.set(agentId, agent);

  // Persist agent to database
  dbRun(
    "INSERT OR REPLACE INTO agents (id, name, room, capabilities, joined_at, last_active, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      agentId,
      agentName,
      roomName,
      JSON.stringify(capabilities),
      agent.joinedAt,
      agent.lastActive,
      agent.status,
    ],
    `agent upsert ${agentName}`
  );

  const joinMessage = {
    id: uuidv4(),
    type: "system",
    agentId: null,
    agentName: "System",
    content: `${agentName} has joined the room`,
    timestamp: nextTimestamp(roomName),
    room: roomName,
    mentions: [],
    metadata: { type: "join" },
  };

  messages.get(roomName).push(joinMessage);

  // Persist message to database
  dbRun(
    "INSERT INTO messages (id, room, agent_id, agent_name, content, type, mentions, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      joinMessage.id,
      roomName,
      null,
      "System",
      joinMessage.content,
      joinMessage.type,
      JSON.stringify(joinMessage.mentions),
      JSON.stringify(joinMessage.metadata),
      joinMessage.timestamp,
    ],
    `join message for ${roomName}`
  );

  io.to(roomName).emit("message", joinMessage);

  logger.info(`Agent ${agentName} (${agentId}) joined room ${roomName}`);

  res.json({
    success: true,
    roomName,
    agentId,
    currentAgents: Array.from(room.agents).map((id) => agents.get(id)),
  });
});

app.post("/api/leave/:agentId", (req, res) => {
  const { agentId } = req.params;
  const agent = agents.get(agentId);

  if (!agent) {
    return res.status(404).json({ success: false, error: "Agent not found" });
  }

  const room = rooms.get(agent.room);
  if (room) {
    room.agents.delete(agentId);

    const leaveMessage = {
      id: uuidv4(),
      type: "system",
      content: `${agent.name} has left the room`,
      timestamp: new Date().toISOString(),
      room: agent.room,
    };

    messages.get(agent.room).push(leaveMessage);
    io.to(agent.room).emit("message", leaveMessage);
  }

  agents.delete(agentId);
  res.json({ success: true });
});

app.post("/api/send", (req, res) => {
  const { agentId, content, metadata = {} } = req.body;
  const agent = agents.get(agentId);

  if (!agent) {
    return res.status(404).json({ success: false, error: "Agent not found" });
  }

  // Parse mentions from content
  const mentions = parseMentions(content);

  const message = {
    id: uuidv4(),
    type: "message",
    agentId,
    agentName: agent.name,
    content,
    mentions,
    metadata,
    timestamp: nextTimestamp(agent.room),
    room: agent.room,
  };

  // Persist BEFORE broadcasting or acknowledging. Previously the emit and the
  // 200 both happened regardless of the write, so a failed INSERT meant every
  // other agent saw a message that would not survive a restart, and the sender
  // was told it succeeded.
  db.run(
    "INSERT INTO messages (id, room, agent_id, agent_name, content, type, mentions, metadata, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      message.id,
      agent.room,
      agentId,
      agent.name,
      content,
      message.type,
      JSON.stringify(mentions),
      JSON.stringify(metadata),
      message.timestamp,
    ],
    function (err) {
      if (err) {
        logger.error(
          `Failed to persist message from ${agent.name} in ${agent.room}: ${err.message}`
        );
        return res.status(500).json({
          success: false,
          error: "Failed to persist message — not delivered",
        });
      }

      messages.get(agent.room).push(message);

      // Update agent last active time
      agent.lastActive = new Date().toISOString();
      dbRun(
        "UPDATE agents SET last_active = ? WHERE id = ?",
        [agent.lastActive, agentId],
        `last_active heartbeat for ${agent.name}`
      );

      // Create notifications for mentions
      if (mentions.length > 0) {
        createNotifications(message, mentions);
      }

      io.to(agent.room).emit("message", message);

      logger.info(
        `Message sent by ${agent.name} in ${agent.room}${
          mentions.length > 0 ? ` with mentions: ${mentions.join(", ")}` : ""
        }`
      );

      res.json({ success: true, messageId: message.id, mentions });
    }
  );
});

app.get("/api/messages/:room", (req, res) => {
  const { room } = req.params;
  const { since, limit = 100 } = req.query;

  // Sort by timestamp before paging. Timestamps are reserved synchronously but
  // the array is appended inside the DB write callback, so under concurrency
  // writes land out of order. Paging by array position would then set the
  // cursor to a message that is not the page maximum, which both re-returns
  // messages already seen and skips ones that were never returned.
  // Copy first — never reorder the stored array during a read.
  let roomMessages = [...(messages.get(room) || [])].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  if (since) {
    const sinceTime = new Date(since).getTime();
    // An unparseable `since` yields NaN, and every `> NaN` comparison is false —
    // which would silently return zero messages instead of erroring. A false
    // "nothing new" is indistinguishable from a quiet room, so reject it loudly.
    if (Number.isNaN(sinceTime)) {
      return res.status(400).json({
        error: `Invalid 'since' timestamp: ${JSON.stringify(since)}. Expected an ISO 8601 timestamp, e.g. 2026-07-23T21:00:00.000Z`,
      });
    }
    // A date-time with no timezone designator ("2026-07-23T16:10:00") is parsed
    // in the SERVER's local timezone, not the caller's. Agents polling from a
    // different timezone would silently get the wrong window, so require an
    // explicit offset (Z or ±HH:MM) and make the cursor absolute.
    if (/\d[T ]\d/.test(since) && !/(Z|[+-]\d{2}:?\d{2})$/.test(since.trim())) {
      return res.status(400).json({
        error: `Ambiguous 'since' timestamp: ${JSON.stringify(since)} has no timezone offset and would be interpreted in the server's timezone. Append 'Z' for UTC or an explicit offset, e.g. 2026-07-23T21:00:00.000Z`,
      });
    }
    roomMessages = roomMessages.filter(
      (m) => new Date(m.timestamp).getTime() > sinceTime
    );
  }

  // `slice(-0)` is `slice(0)` — the WHOLE array — so a limit of 0 would return
  // everything instead of nothing. Clamp to a non-negative integer and handle
  // 0 explicitly, so `limit=0` is a usable "count only, send no messages" query.
  const parsed = parseInt(limit);
  const max = Number.isFinite(parsed) && parsed >= 0 ? parsed : 100;
  const matched = roomMessages.length;

  // Truncation direction matters.
  //   - No `since`: the caller wants the most recent N, so take the tail.
  //   - With `since`: the caller is walking forward through a backlog. Taking
  //     the tail would return the NEWEST N and skip the oldest unseen ones —
  //     and because the caller then advances its cursor past them, they would
  //     never be seen again. Take the head so repeated polls walk the backlog
  //     contiguously.
  const page =
    max === 0
      ? [] // count-only query
      : since
        ? roomMessages.slice(0, max)
        : roomMessages.slice(-max);

  // On a count-only query, report who the new messages are FROM. Lets an agent
  // see both its own new-message count and every other participant's without
  // transferring a single message body.
  let byAgent;
  if (max === 0) {
    byAgent = {};
    for (const m of roomMessages) {
      const who = m.agentName || "unknown";
      byAgent[who] = (byAgent[who] || 0) + 1;
    }
  }

  res.json({
    messages: page,
    // `matched` is the full size of the window before truncation, so callers
    // can tell "50 messages" from "50 of 120 messages".
    matched,
    returned: page.length,
    hasMore: page.length < matched,
    ...(byAgent ? { byAgent } : {}),
  });
});

app.get("/api/rooms", (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([name, room]) => ({
    name,
    agentCount: room.agents.size,
    agents: Array.from(room.agents)
      .map((id) => agents.get(id))
      .filter(Boolean),
    createdAt: room.createdAt,
  }));

  res.json({ rooms: roomList });
});

app.get("/api/agents/:room", (req, res) => {
  const { room: roomName } = req.params;
  const room = rooms.get(roomName);

  if (!room) {
    return res.status(404).json({ success: false, error: "Room not found" });
  }

  const roomAgents = Array.from(room.agents)
    .map((id) => agents.get(id))
    .filter(Boolean);

  res.json({ agents: roomAgents });
});

// Task endpoints
app.post("/api/tasks", (req, res) => {
  const {
    roomName,
    title,
    description,
    assignee,
    creator,
    priority = "medium",
  } = req.body;

  const task = {
    id: uuidv4(),
    room: roomName,
    title,
    description,
    assignee,
    creator,
    priority,
    status: "todo",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Bug 3 fix: persist task to DB on creation.
  // The write gates the in-memory insert, the broadcast and the 200 — a task
  // reported as created must actually exist on disk.
  db.run(
    "INSERT INTO tasks (id, room, title, description, assignee, creator, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [task.id, task.room, task.title, task.description, task.assignee, task.creator, task.priority, task.status, task.createdAt, task.updatedAt],
    function (err) {
      if (err) {
        logger.error(`Failed to persist task ${task.id}: ${err.message}`);
        return res
          .status(500)
          .json({ success: false, error: "Failed to persist task" });
      }

      tasks.set(task.id, task);

      io.to(roomName).emit("task", { type: "created", task });

      // Bug 5 fix: also emit task_assigned so mcp-server.js listeners fire
      if (task.assignee) {
        io.to(roomName).emit("task_assigned", task);
      }

      res.json({ success: true, task });
    }
  );
});

app.get("/api/tasks/:room", (req, res) => {
  const { room } = req.params;
  const roomTasks = Array.from(tasks.values()).filter((t) => t.room === room);
  res.json({ tasks: roomTasks });
});

// Bug 4 fix: single-task GET and PUT routes used by the CLI
app.get("/api/tasks/:room/:taskId", (req, res) => {
  const { room, taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task || task.room !== room) {
    return res.status(404).json({ success: false, error: "Task not found" });
  }
  res.json({ success: true, task });
});

app.put("/api/tasks/:room/:taskId", (req, res) => {
  const { room, taskId } = req.params;
  const task = tasks.get(taskId);
  if (!task || task.room !== room) {
    return res.status(404).json({ success: false, error: "Task not found" });
  }
  const { status, assignee, priority } = req.body;
  if (status) task.status = status;
  if (assignee) task.assignee = assignee;
  if (priority) task.priority = priority;
  task.updatedAt = new Date().toISOString();
  db.run(
    "UPDATE tasks SET status = ?, assignee = ?, priority = ?, updated_at = ? WHERE id = ?",
    [task.status, task.assignee, task.priority, task.updatedAt, task.id],
    function (err) {
      if (err) {
        logger.error(`Failed to persist update to task ${task.id}: ${err.message}`);
        return res
          .status(500)
          .json({ success: false, error: "Failed to persist task update" });
      }
      res.json({ success: true, task });
    }
  );
});

// Agent management endpoints
app.get("/api/stats", (req, res) => {
  const stats = {
    totalRooms: rooms.size,
    totalAgents: agents.size,
    totalTasks: tasks.size,
    sharedDirectory: SHARED_DIR,
    rooms: Array.from(rooms.entries()).map(([name, room]) => ({
      name,
      agentCount: room.agents.size,
      messageCount: messages.get(name)?.length || 0,
      isActive: room.isActive,
    })),
  };
  res.json(stats);
});

app.post("/api/broadcast/:room", (req, res) => {
  const { room: roomName } = req.params;
  const { content, from = "Orchestrator" } = req.body;

  const message = {
    id: uuidv4(),
    type: "broadcast",
    content: `[${from}] ${content}`,
    timestamp: nextTimestamp(roomName),
    room: roomName,
    from,
  };

  messages.get(roomName)?.push(message);
  io.to(roomName).emit("message", message);

  res.json({ success: true, messageId: message.id });
});

app.post("/api/tasks/:taskId/update", (req, res) => {
  const { taskId } = req.params;
  const { status, assignee, priority } = req.body;

  const task = tasks.get(taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: "Task not found" });
  }

  if (status) task.status = status;
  if (assignee) task.assignee = assignee;
  if (priority) task.priority = priority;
  task.updatedAt = new Date().toISOString();

  // Update in database — gates the broadcast and the 200.
  db.run(
    "UPDATE tasks SET status = ?, assignee = ?, priority = ?, updated_at = ? WHERE id = ?",
    [task.status, task.assignee, task.priority, task.updatedAt, taskId],
    function (err) {
      if (err) {
        logger.error(`Failed to persist update to task ${taskId}: ${err.message}`);
        return res
          .status(500)
          .json({ success: false, error: "Failed to persist task update" });
      }

      io.to(task.room).emit("task", { type: "updated", task });

      logger.info(
        `Task ${taskId} updated: status=${task.status}, assignee=${task.assignee}`
      );

      res.json({ success: true, task });
    }
  );
});

// Agent memory endpoints
app.post("/api/memory/:agentId", (req, res) => {
  const { agentId } = req.params;
  const { key, value, type = "note", expiresIn } = req.body;

  const agent = agents.get(agentId);
  if (!agent) {
    return res.status(404).json({ success: false, error: "Agent not found" });
  }

  const memoryId = uuidv4();
  const expiresAt = expiresIn
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  const memory = {
    id: memoryId,
    agentId,
    room: agent.room,
    key,
    value,
    type,
    createdAt: new Date().toISOString(),
    expiresAt,
  };

  // Store in database — gates the 200, since "stored" must mean stored.
  db.run(
    "INSERT INTO agent_memory (id, agent_id, room, key, value, type, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      memoryId,
      agentId,
      agent.room,
      key,
      value,
      type,
      memory.createdAt,
      expiresAt,
    ],
    function (err) {
      if (err) {
        logger.error(
          `Failed to store memory "${key}" for agent ${agent.name}: ${err.message}`
        );
        return res
          .status(500)
          .json({ success: false, error: "Failed to store memory" });
      }

      logger.info(`Memory stored for agent ${agent.name}: ${key}`);

      res.json({ success: true, memoryId, memory });
    }
  );
});

app.get("/api/memory/:agentId", (req, res) => {
  const { agentId } = req.params;
  const { key, type } = req.query;

  let query =
    "SELECT * FROM agent_memory WHERE agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))";
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
      logger.error("Failed to retrieve agent memory:", err);
      return res.status(500).json({ success: false, error: "Database error" });
    }

    res.json({ success: true, memories: rows });
  });
});

app.get("/api/notifications/:agentId", (req, res) => {
  const { agentId } = req.params;
  const { unreadOnly = false, agentName, room } = req.query;

  // Match by agent_id OR agent_name (case-insensitive) so offline agents
  // that were @mentioned can retrieve their notifications after joining.
  //
  // `room` is optional and opt-in: retrieval is NOT room-scoped by default,
  // because narrowing it silently would hide mentions an agent was already
  // relying on. Callers that only care about the room they are working in
  // pass it explicitly; the room is reported on every notification either way.
  let match = "(agent_id = ? OR LOWER(agent_name) = LOWER(?))";
  const params = [agentId, agentName || agentId];
  if (room) {
    match += " AND room = ?";
    params.push(room);
  }

  let query = `SELECT * FROM notifications WHERE ${match}`;
  if (unreadOnly === "true") {
    query += " AND is_read = 0";
  }

  // Bounded page, but the caller is told the true totals so it can tell
  // "50 notifications" from "50 of 120" — and page back with `offset`
  // instead of older notifications being permanently unreachable.
  const max = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
  const offset = parseInt(req.query.offset || "0", 10) || 0;
  query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";

  db.all(query, [...params, max, offset], (err, rows) => {
    if (err) {
      logger.error("Failed to retrieve notifications:", err);
      return res.status(500).json({ success: false, error: "Database error" });
    }

    // Real totals, counted in SQL rather than inferred from the page.
    db.get(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
         FROM notifications WHERE ${match}`,
      params,
      (countErr, counts) => {
        if (countErr) {
          logger.error("Failed to count notifications:", countErr);
          return res
            .status(500)
            .json({ success: false, error: "Database error" });
        }

        const total = counts?.total || 0;
        const unread = counts?.unread || 0;
        res.json({
          success: true,
          notifications: rows,
          returned: rows.length,
          total,
          unread,
          hasMore: offset + rows.length < (unreadOnly === "true" ? unread : total),
        });
      }
    );
  });
});

app.post("/api/notifications/:notificationId/read", (req, res) => {
  const { notificationId } = req.params;

  db.run(
    "UPDATE notifications SET is_read = 1 WHERE id = ?",
    [notificationId],
    function (err) {
      if (err) {
        logger.error("Failed to mark notification as read:", err);
        return res
          .status(500)
          .json({ success: false, error: "Database error" });
      }

      res.json({ success: true, updated: this.changes > 0 });
    }
  );
});

// WebSocket handling
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("register", ({ agentId, room }) => {
    const agent = agents.get(agentId);
    if (agent) {
      agent.socketId = socket.id;
      socket.join(room);
      console.log(`Agent ${agent.name} registered with socket ${socket.id}`);
    }
  });

  socket.on("message", (data) => {
    if (data.room) {
      io.to(data.room).emit("message", data);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Start server
const PORT = process.env.PORT || 3000;

/**
 * Graceful shutdown.
 *
 * Message/task/notification writes use fire-and-forget `db.run(...)`, so
 * statements can still be queued in the sqlite3 driver when systemd sends
 * SIGTERM. Without this, a restart silently drops whatever was in flight —
 * messages that were acknowledged to the sender with `{success: true}`.
 * db.close() waits for queued statements to finish before closing.
 */
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — draining pending database writes`);

  // Stop accepting new work. Socket.IO holds persistent connections, so
  // httpServer.close() would never fire its callback until every agent
  // disconnects — the DB flush must NOT be gated behind it.
  io.close();
  httpServer.close();

  // This is the part that actually matters for durability: db.close() waits
  // for queued statements to finish before closing.
  db.close((err) => {
    if (err) logger.error("Error closing database:", err);
    else logger.info("Database closed cleanly");
    process.exit(0);
  });

  // Don't hang forever if a socket refuses to close.
  setTimeout(() => {
    logger.error("Shutdown timed out — forcing exit");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

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
