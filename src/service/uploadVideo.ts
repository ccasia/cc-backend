import amqplib from 'amqplib';
import { uploadPitchVideo } from 'src/config/cloudStorage.config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const conn = await amqplib.connect('amqp://host.docker.internal');

  const channel = conn.createChannel();

  (await channel).consume('uploadVideo', async (data) => {
    let video = data?.content.toString() as any;
    video = JSON.parse(video);
    const publicURL = await uploadPitchVideo(video.content.tempFilePath, video.content.name, 'pitchVideo');
    await prisma.pitch.update({
      where: {
        id: video.pitchId,
      },
      data: {
        content: publicURL,
        status: 'undecided',
      },
    });
    (await channel).ack(data as any);
  });
})();
