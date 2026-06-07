module.exports = {
  apps: [
    { name: 'server', script: 'src/server.js' },
    { name: 'worker', script: 'src/helper/worker.js', max_memory_restart: '300M' },
  ],
};
