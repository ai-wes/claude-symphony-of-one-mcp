# Transport Adapters

The hub's messaging layer is decoupled from the rest of the server via a transport adapter. This lets the protocol underneath (Socket.IO today, Matrix tomorrow) be swapped without touching MCP tools or business logic.

## The contract

Every transport extends `transport/transport.js` and must implement these 14 methods:

| Method | Description |
|---|---|
| `connect(agentId, room)` | Connect to the hub and join `room`. |
| `disconnect()` | Disconnect and release all resources. |
| `joinRoom(room)` | Join (or re-join) a room after initial connect. |
| `leaveRoom(agentId)` | Leave the current room. |
| `sendMessage(content, metadata)` | Broadcast a message to the current room. |
| `getMessages(room, since, limit)` | Fetch messages from `room`, optionally since an ISO timestamp. |
| `onMessage(cb)` | Register a callback for incoming message events. |
| `onNotification(cb)` | Register a callback for incoming notification events. |
| `createTask(room, task)` | Create a task in `room`. `task` is `{ title, description, assignee, priority, creator }`. |
| `getTasks(room, filter)` | Fetch tasks from `room`. `filter` is `{ status, assignee, priority }`. |
| `updateTask(taskId, patch)` | Apply `patch` to an existing task. |
| `storeMemory(agentId, kv)` | Store a key/value pair for `agentId`. `kv` is `{ key, value, type, expiresIn }`. |
| `retrieveMemory(agentId, query)` | Retrieve memories for `agentId`. `query` is `{ key, type }`. |

All methods are `async` and must either resolve with the expected value or throw.

## Selecting a backend

Set `SYMPHONY_TRANSPORT` before starting the MCP client:

```bash
SYMPHONY_TRANSPORT=hub node mcp-server.js      # default — SocketIoHubTransport
SYMPHONY_TRANSPORT=matrix node mcp-server.js   # MatrixTransport (stub)
```

When `SYMPHONY_TRANSPORT` is unset or set to `hub`, `createTransport()` returns a `SocketIoHubTransport`. The factory reads the env var at call time, so you can override it in tests without reimporting the module.

## Included adapters

### `SocketIoHubTransport` (default)

Talks to `server.js` over HTTP REST + Socket.IO. This is the production-ready adapter.

- REST calls carry `x-auth-token` when `AUTH_TOKEN` is set.
- Real-time events (`message`, `notification`) are delivered via the Socket.IO connection established in `connect()`.

### `MatrixTransport` (stub)

`transport/matrix-transport.js` — extends `Transport` but throws `Error('not implemented')` on every method. It exists as a slot: implement the Matrix Client-Server API calls inside each method to bring up a Matrix backend without changing any upstream code.

## Adding a new transport

1. Create `transport/my-transport.js` extending `Transport`.
2. Implement all 14 contract methods.
3. Add an import and branch in `transport/index.js`:

```js
import MyTransport from './my-transport.js';

export function createTransport(config = {}) {
  const backend = process.env.SYMPHONY_TRANSPORT || 'hub';
  if (backend === 'my')    return new MyTransport(config);
  if (backend === 'matrix') return new MatrixTransport(config);
  return new SocketIoHubTransport(config);
}
```

4. Add a test in `test/transport.test.js` asserting your transport implements all contract methods.
