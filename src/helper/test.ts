import { delay, Job, Queue, QueueEvents, Worker } from 'bullmq';
import IORedis from 'ioredis';

(async () => {
  const connection = new IORedis({
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  });

  const myQueue = new Queue('Paint', { connection });

  const test = await myQueue.add(
    'house',
    { color: 'white' },
    { removeOnComplete: true, jobId: 'house-120', attempts: 3 },
  );

  const worker = new Worker(
    'Paint',
    async (job: Job) => {
      let progress = 1;

      while (progress !== 100) {
        progress += 1;
        await delay(50);
        if (progress == 50) {
          throw new Error('Error');
        }
        await job.updateProgress(progress);
      }

      console.log('Do something with job', job.id);
      return 'some value';
    },
    { connection },
  );

  worker.on('completed', (job) => {
    console.log('worker done painting', job.id, new Date());
  });

  worker.on('failed', (job, error) => {
    console.error('worker fail painting', job?.id, error, job?.data);
  });

  const queueEvents = new QueueEvents('Paint', { connection });

  queueEvents.on('added', (job) => {
    console.log(job);
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    console.log(`Progress update → ${jobId}:`, data);
  });

  process.on('SIGTERM', async () => {
    process.exit(0);
  });
})();
