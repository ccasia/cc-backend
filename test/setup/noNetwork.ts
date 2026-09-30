import net from 'node:net';

// Unit tests must not contact providers or the application database.
net.Socket.prototype.connect = function blockedConnection(): never {
  throw new Error('Network access is disabled in unit tests. Mock the external boundary.');
} as typeof net.Socket.prototype.connect;
