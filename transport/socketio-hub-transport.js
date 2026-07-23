/**
 * SocketIoHubTransport — concrete adapter for the Symphony Hub backend.
 *
 * Encapsulates all axios REST calls and socket.io-client usage so the rest of
 * the application is free of transport details.
 */
import axios from 'axios';
import { io } from 'socket.io-client';
import Transport from './transport.js';

export default class SocketIoHubTransport extends Transport {
  /**
   * @param {object} config
   * @param {string} config.serverUrl
   * @param {string} config.authToken
   * @param {string} config.agentName
   */
  constructor({ serverUrl, authToken, agentName } = {}) {
    super();
    this._serverUrl = serverUrl || process.env.CHAT_SERVER_URL || 'http://localhost:3000';
    this._authToken = authToken || '';
    this._agentName = agentName || '';
    this._socket = null;
    this._agentId = null;
    this._room = null;
    this._messageCallbacks = [];
    this._notificationCallbacks = [];

    // Set auth header on this instance's axios if token is provided.
    // We use a local axios instance to avoid mutating the shared default.
    this._axios = axios.create({
      baseURL: this._serverUrl,
    });
    if (this._authToken) {
      this._axios.defaults.headers.common['x-auth-token'] = this._authToken;
    }
  }

  /**
   * POST /api/join/:room then open the socket.
   * @param {string} agentId
   * @param {string} room
   */
  async connect(agentId, room) {
    this._agentId = agentId;
    this._room = room;

    await this._axios.post(`/api/join/${room}`, {
      agentId,
      agentName: this._agentName,
      capabilities: {
        role: 'ai-agent',
        type: 'claude',
      },
    });

    this._openSocket();
    return this;
  }

  /**
   * Open / re-open the socket.io connection.
   * Mirrors the original connectSocket() function from mcp-server.js verbatim.
   */
  _openSocket() {
    if (this._socket) this._socket.disconnect();

    this._socket = io(this._serverUrl, {
      auth: this._authToken ? { token: this._authToken } : {},
    });

    const agentId = this._agentId;
    const room = this._room;
    const agentName = this._agentName;

    this._socket.on('connect', () => {
      console.error(`[${agentName}] Connected to chat server at ${this._serverUrl}`);
      if (agentId && room) {
        this._socket.emit('register', { agentId, room });
      }
    });

    this._socket.on('message', (message) => {
      for (const cb of this._messageCallbacks) cb(message);
    });

    this._socket.on('notification', (notification) => {
      for (const cb of this._notificationCallbacks) cb(notification);
    });

    this._socket.on('task_assigned', (task) => {
      // Broadcast task_assigned as a synthetic notification so callers
      // can handle it via onNotification if needed; the MCP server registers
      // its own callback for task_assigned through onNotification using
      // a { _isTask: true } marker is one approach, but to keep the
      // interface clean we emit a distinct 'task_assigned' event to
      // the notification callbacks with a distinguishable shape.
      for (const cb of this._notificationCallbacks) {
        cb({ _taskAssigned: true, task });
      }
    });

    this._socket.on('disconnect', () => {
      console.error(`[${agentName}] Disconnected from chat server`);
    });
  }

  /**
   * Disconnect and clean up.
   */
  async disconnect() {
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
  }

  /**
   * Re-join a room (alias for re-registering).
   * @param {string} room
   */
  async joinRoom(room) {
    this._room = room;
    if (this._socket && this._socket.connected) {
      this._socket.emit('register', { agentId: this._agentId, room });
    }
  }

  /**
   * POST /api/leave/:agentId
   * @param {string} agentId
   */
  async leaveRoom(agentId) {
    return this._axios.post(`/api/leave/${agentId}`);
  }

  /**
   * POST /api/send
   * @param {string} content
   * @param {object} metadata
   */
  async sendMessage(content, metadata) {
    return this._axios.post('/api/send', {
      agentId: this._agentId,
      content,
      metadata,
    });
  }

  /**
   * GET /api/messages/:room
   * @param {string} room
   * @param {string|undefined} since
   * @param {number} limit
   */
  async getMessages(room, since, limit) {
    return this._axios.get(`/api/messages/${room}`, {
      params: { since, limit },
    });
  }

  /**
   * GET /api/notifications/:agentId — fetch server-side notifications by
   * agent ID and name so agents can retrieve @mentions they missed while offline.
   * @param {string} agentId
   * @param {string} agentName
   * @param {boolean} unreadOnly
   */
  async getNotifications(agentId, agentName, unreadOnly, room) {
    return this._axios.get(`/api/notifications/${agentId}`, {
      params: {
        agentName,
        unreadOnly: unreadOnly ? 'true' : undefined,
        room: room || undefined,
      },
    });
  }

  /**
   * Register a callback invoked for every incoming 'message' socket event.
   * @param {function} cb
   */
  onMessage(cb) {
    this._messageCallbacks.push(cb);
  }

  /**
   * Register a callback invoked for every incoming 'notification' and
   * 'task_assigned' socket event.
   * @param {function} cb
   */
  onNotification(cb) {
    this._notificationCallbacks.push(cb);
  }

  /**
   * POST /api/tasks — the hub takes the room in the BODY as `roomName`.
   *
   * This previously posted to /api/tasks/:room, which matches no route on the
   * hub and 404'd, so create_task never worked over MCP.
   * @param {string} room
   * @param {object} task
   */
  async createTask(room, task) {
    return this._axios.post(`/api/tasks`, { ...task, roomName: room });
  }

  /**
   * GET /api/stats — room/agent/task counts and per-room message counts.
   * Cheap: returns counts only, never message bodies.
   */
  async getStats() {
    return this._axios.get(`/api/stats`);
  }

  /**
   * GET /api/rooms — list every room with agent counts.
   */
  async getRooms() {
    return this._axios.get(`/api/rooms`);
  }

  /**
   * GET /api/agents/:room — who is currently in a room.
   * @param {string} room
   */
  async getAgents(room) {
    return this._axios.get(`/api/agents/${room}`);
  }

  /**
   * POST /api/notifications/:id/read — mark one notification read.
   * Without this an agent's unread count can only ever grow.
   * @param {string} notificationId
   */
  async markNotificationRead(notificationId) {
    return this._axios.post(`/api/notifications/${notificationId}/read`);
  }

  /**
   * GET /api/tasks/:room
   * @param {string} room
   * @param {object} filter
   */
  async getTasks(room, filter) {
    return this._axios.get(`/api/tasks/${room}`, { params: filter });
  }

  /**
   * POST /api/tasks/:taskId/update
   *
   * The hub exposes no PATCH route, so the previous
   * `patch('/api/tasks/:taskId')` never matched and update_task failed.
   * @param {string} taskId
   * @param {object} patch  { status?, assignee?, priority? }
   */
  async updateTask(taskId, patch) {
    return this._axios.post(`/api/tasks/${taskId}/update`, patch);
  }

  /**
   * POST /api/memory/:agentId
   * @param {string} agentId
   * @param {object} kv
   */
  async storeMemory(agentId, kv) {
    return this._axios.post(`/api/memory/${agentId}`, kv);
  }

  /**
   * GET /api/memory/:agentId
   * @param {string} agentId
   * @param {object} query  { key, type }
   */
  async retrieveMemory(agentId, query) {
    const params = new URLSearchParams();
    if (query.key) params.append('key', query.key);
    if (query.type) params.append('type', query.type);
    return this._axios.get(`/api/memory/${agentId}?${params}`);
  }
}
