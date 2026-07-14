import { buildGcsPublicUrl, storage } from '@configs/cloudStorage.config';
import amqp from 'amqplib';
import dayjs from 'dayjs';
import fse from 'fs-extra';
import { getIo } from '../config/socket';

(async () => {
  console.log('Raw footages processing');
  try {
    const bucket = storage.bucket(process.env.BUCKET_NAME as string);
    const connection = await amqp.connect(process.env.RABBIT_MQ as string);
    const channel = await connection.createChannel();

    await channel.consume('rawFootage', async (msg) => {
      if (msg) {
        let uploadedBytes = 0;
        const data = JSON.parse(msg?.content.toString());
        const { tempFilePath, name, mimetype } = data;

        const readStream = fse.createReadStream(tempFilePath);

        const blob = bucket.file(`rawFootages/${dayjs().format()}-${name}`);

        const totalBytes = fse.statSync(tempFilePath).size;

        const blobStream = blob.createWriteStream({
          resumable: false,
          contentType: mimetype,
        });

        readStream.on('data', (chunk) => {
          uploadedBytes += chunk.length;
          const percentage = Math.round((uploadedBytes / totalBytes) * 100);
          getIo().emit('uploadProgress', { name: name, percentage, isDone: false });
        });

        // await new Promise<void>((resolve, reject) => {
        readStream
          .pipe(blobStream)
          .on('error', (err) => {
            console.error('Error uploading to GCS:', err);
            // reject('Failed to upload file.');
          })
          .on('finish', async () => {
            await blob.makePublic();
            const publicUrl = buildGcsPublicUrl(bucket.name, blob.name);
            fse.unlinkSync(tempFilePath); // Cleanup temp file
            getIo().emit('uploadProgress', { name: name, percentage: 100, isDone: true });
          });
        // });

        channel.ack(msg);
      }
    });
  } catch (error) {
    throw new Error(error);
  }
})();
