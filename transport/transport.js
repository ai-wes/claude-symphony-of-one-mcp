/**
 * Transport adapter base class.
 *
 * Defines the interface every backend must implement.
 * Concrete adapters (SocketIoHubTransport, MatrixTransport, …) extend this
 * class and override every method.
 *
 * All methods are async and must return a resolved value or throw.
 */
export default class Transport {
  /**
   * Connect to the hub and join a room.
   * @param {string} agentId
   * @param {string} room
   */
  async connect(agentId, room) {
    throw new Error('connect not implemented');
  }

  /**
   * Disconnect and clean up all resources.
   */
  async disconnect() {
    throw new Error('disconnect not implemented');
  }

  /**
   * Alias / re-join a room.
   * @param {string} room
   */
  async joinRoom(room) {
    throw new Error('joinRoom not implemented');
  }

  /**
   * HTTP POST to leave the current room.
   * @param {string} agentId
   */
  async leaveRoom(agentId) {
    throw new Error('leaveRoom not implemented');
  }

  /**
   * HTTP POST to /api/send — broadcast a message to the room.
   * @param {string} content
   * @param {object} metadata
   */
  async sendMessage(content, metadata) {
    throw new Error('sendMessage not implemented');
  }

  /**
   * HTTP GET /api/messages/:room — fetch messages from the server.
   * @param {string} room
   * @param {string|undefined} since  ISO timestamp
   * @param {number} limit
   */
  async getMessages(room, since, limit) {
    throw new Error('getMessages not implemented');
  }

  /**
   * Register a callback for incoming socket 'message' events.
   * The callback is called with the raw message object.
   * @param {function} cb
   */
  onMessage(cb) {
    throw new Error('onMessage not implemented');
  }

  /**
   * Register a callback for incoming socket 'notification' events.
   * @param {function} cb
   */
  onNotification(cb) {
    throw new Error('onNotification not implemented');
  }

  /**
   * HTTP POST /api/tasks/:room — create a new task.
   * @param {string} room
   * @param {object} task  { title, description, assignee, priority, creator }
   */
  async createTask(room, task) {
    throw new Error('createTask not implemented');
  }

  /**
   * HTTP GET /api/tasks/:room — fetch tasks.
   * @param {string} room
   * @param {object} filter  { status, assignee, priority }
   */
  async getTasks(room, filter) {
    throw new Error('getTasks not implemented');
  }

  /**
   * HTTP PATCH /api/tasks/:taskId (or server's update route) — update a task.
   * @param {string} taskId
   * @param {object} patch
   */
  async updateTask(taskId, patch) {
    throw new Error('updateTask not implemented');
  }

  /**
   * HTTP POST /api/memory/:agentId — store a key/value pair.
   * @param {string} agentId
   * @param {object} kv  { key, value, type, expiresIn }
   */
  async storeMemory(agentId, kv) {
    throw new Error('storeMemory not implemented');
  }

  /**
   * HTTP GET /api/memory/:agentId — retrieve memories.
   * @param {string} agentId
   * @param {object} query  { key, type }
   */
  async retrieveMemory(agentId, query) {
    throw new Error('retrieveMemory not implemented');
  }
}
