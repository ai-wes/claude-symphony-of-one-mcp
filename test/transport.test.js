/**
 * Transport layer tests — Phase 2
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Transport factory', () => {
  it('returns SocketIoHubTransport by default', async () => {
    delete process.env.SYMPHONY_TRANSPORT;
    const { createTransport } = await import('../transport/index.js');
    const SocketIoHubTransport = (await import('../transport/socketio-hub-transport.js')).default;
    const t = createTransport({ serverUrl: 'http://localhost:9999', authToken: '', agentName: 'test' });
    assert.ok(t instanceof SocketIoHubTransport, 'default transport must be SocketIoHubTransport');
  });

  it('returns MatrixTransport when SYMPHONY_TRANSPORT=matrix', async () => {
    process.env.SYMPHONY_TRANSPORT = 'matrix';
    // Must use a fresh import due to module cache — use a sub-process or re-import trick
    // Use the factory directly since env is set before first import in this process:
    const { createTransport } = await import('../transport/index.js');
    const MatrixTransport = (await import('../transport/matrix-transport.js')).default;
    const t = createTransport({ serverUrl: 'http://localhost:9999', authToken: '', agentName: 'test' });
    assert.ok(t instanceof MatrixTransport, 'must return MatrixTransport when SYMPHONY_TRANSPORT=matrix');
    delete process.env.SYMPHONY_TRANSPORT;
  });

  it('MatrixTransport throws on every method', async () => {
    const MatrixTransport = (await import('../transport/matrix-transport.js')).default;
    const t = new MatrixTransport({});
    const methods = ['connect','disconnect','joinRoom','leaveRoom','sendMessage','getMessages','onMessage','onNotification','createTask','getTasks','updateTask','storeMemory','retrieveMemory'];
    for (const method of methods) {
      assert.throws(() => t[method](), /Phase 8/, `${method} must throw Phase 8 error`);
    }
  });

  it('SocketIoHubTransport implements every contract method', async () => {
    const SocketIoHubTransport = (await import('../transport/socketio-hub-transport.js')).default;
    const t = new SocketIoHubTransport({ serverUrl: 'http://localhost:9999', authToken: '', agentName: 'test' });
    const methods = ['connect','disconnect','joinRoom','leaveRoom','sendMessage','getMessages','onMessage','onNotification','createTask','getTasks','updateTask','storeMemory','retrieveMemory'];
    for (const method of methods) {
      assert.equal(typeof t[method], 'function', `SocketIoHubTransport.${method} must be a function`);
    }
  });
});
