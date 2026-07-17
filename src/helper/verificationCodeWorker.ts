import { Worker } from 'bullmq';
import connection from '@configs/redis';
import axios from 'axios';
import { WhatsappSetting } from '@prisma/client';

const worker = new Worker(
  'verification-code',
  async (job) => {
    const data = job.data as { to: string; settings: WhatsappSetting; code: string };

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: data.to.toString(),
      type: 'template',
      template: {
        name: data.settings.templateName?.toString(),
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: data.code,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [
              {
                type: 'text',
                text: data.code,
              },
            ],
          },
        ],
      },
    };

    try {
      const res = await axios.post(`https://graph.facebook.com/v22.0/${data.settings.phoneNumberId}/messages`, body, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.settings.accessToken}`,
        },
      });
      console.log(res.data);
    } catch (error) {
      console.log(error);
    }
  },
  { connection },
);

worker.on('ready', () => {
  console.log('Verification Code Worker is ready');
});

worker.on('completed', () => {
  console.log('Verification Code worker completed.');
});

worker.on('error', (error) => {
  console.error('Verification Code worker error:', error);
});

const shutdown = async () => {
  await worker.close();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
