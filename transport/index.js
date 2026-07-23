/**
 * Transport factory.
 *
 * Reads SYMPHONY_TRANSPORT at call time (not module-load time) so that tests
 * can set the env var before calling createTransport() without needing to
 * re-import the module.
 */
import SocketIoHubTransport from './socketio-hub-transport.js';
import MatrixTransport from './matrix-transport.js';

/**
 * @param {object} config  Forwarded to the transport constructor.
 * @returns {import('./transport.js').default}
 */
export function createTransport(config = {}) {
  const backend = process.env.SYMPHONY_TRANSPORT || 'hub';
  if (backend === 'matrix') return new MatrixTransport(config);
  return new SocketIoHubTransport(config);
}
