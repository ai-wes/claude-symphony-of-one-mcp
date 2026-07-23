/**
 * MatrixTransport — stub for the future Matrix backend (Phase 8).
 *
 * Every method throws synchronously so that callers using assert.throws()
 * can catch the error without needing assert.rejects().
 * Replace this file with a real implementation when Phase 8 begins.
 */
import Transport from './transport.js';

export default class MatrixTransport extends Transport {
  connect()        { throw new Error('MatrixTransport not implemented — Phase 8'); }
  disconnect()     { throw new Error('MatrixTransport not implemented — Phase 8'); }
  joinRoom()       { throw new Error('MatrixTransport not implemented — Phase 8'); }
  leaveRoom()      { throw new Error('MatrixTransport not implemented — Phase 8'); }
  sendMessage()    { throw new Error('MatrixTransport not implemented — Phase 8'); }
  getMessages()    { throw new Error('MatrixTransport not implemented — Phase 8'); }
  onMessage()      { throw new Error('MatrixTransport not implemented — Phase 8'); }
  onNotification() { throw new Error('MatrixTransport not implemented — Phase 8'); }
  createTask()     { throw new Error('MatrixTransport not implemented — Phase 8'); }
  getTasks()            { throw new Error('MatrixTransport not implemented — Phase 8'); }
  getNotifications()    { throw new Error('MatrixTransport not implemented — Phase 8'); }
  updateTask()     { throw new Error('MatrixTransport not implemented — Phase 8'); }
  storeMemory()    { throw new Error('MatrixTransport not implemented — Phase 8'); }
  retrieveMemory() { throw new Error('MatrixTransport not implemented — Phase 8'); }
}
