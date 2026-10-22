// pm2 cluster mode runs several copies of server.js (see ecosystem.config.js). Work that must
// happen once per deployment, like relaying BullMQ queue events to sockets, runs on instance 0 only.
// NODE_APP_INSTANCE is unset outside pm2 (`yarn dev`), where the single process counts as primary.
export const isPrimaryInstance = (process.env.NODE_APP_INSTANCE ?? '0') === '0';
