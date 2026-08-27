module.exports = {
  apps: [
    {
      name: 'cc-backend-api',
      script: 'server.js',
    },
    {
      name: 'invoice-worker',
      script: 'helper/worker.js', // wherever your BullMQ worker entrypoint is
      instances: 1, // usually keep workers at 1 instance unless designed for horizontal scaling
      autorestart: true,
    },
    {
      name: 'compression-worker',
      script: 'helper/compressionWorker.js', // wherever your BullMQ worker entrypoint is
      instances: 1, // usually keep workers at 1 instance unless designed for horizontal scaling
      autorestart: true,
    },
    {
      name: 'whatsapp-worker',
      script: 'helper/verificationCodeWorker.js', // wherever your BullMQ worker entrypoint is
      instances: 1, // usually keep workers at 1 instance unless designed for horizontal scaling
      autorestart: true,
    },
  ],
};
