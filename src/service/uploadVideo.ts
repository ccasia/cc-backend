import amqplib from 'amqplib';
import { uploadPitchVideo } from 'src/config/cloudStorage.config';
import { Entity, PrismaClient, User } from '@prisma/client';
import { clients, io } from 'src/server';
import { Title, saveNotification } from 'src/controller/notificationController';

const prisma = new PrismaClient();

(async () => {
  const conn = await amqplib.connect('amqp://host.docker.internal');

  const channel = conn.createChannel();

  (await channel).assertQueue('uploadVideo', {
    durable: false,
  });
  (await channel).assertQueue('uploadFirstDraft');

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

  (await channel).consume('uploadFirstDraft', async (data) => {
    let video = data?.content.toString() as any;
    video = JSON.parse(video);
    const publicURL = await uploadPitchVideo(video.video.tempFilePath, video.video.name, 'firstDraft');
    const draft = await prisma.firstDraft.update({
      where: {
        id: video.draftId,
      },
      data: {
        draftURL: publicURL,
        status: 'Submitted',
      },
      include: {
        campaign: {
          include: {
            campaignAdmin: {
              include: {
                admin: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        creator: true,
      },
    });
    // const newDraft = await saveNotification(
    //   draft.creatorId,
    //   Title.Create,
    //   `Your draft has been successfully sent.`,
    //   Entity.User,
    // );
    // await prisma.campaignTimelineTask.update({
    //   where: {
    //     id: video.taskId,
    //   },
    //   data: {
    //     status: 'PENDING_REVIEW',
    //   },
    // });
    const [newDraftNotification] = await Promise.all([
      saveNotification(draft.creatorId, Title.Create, `Your draft has been successfully sent.`, Entity.User),
      prisma.campaignTask.update({
        where: { id: video.taskId },
        data: { status: 'PENDING_REVIEW' },
      }),
    ]);
    io.to(clients.get(draft.creatorId)).emit('notification', newDraftNotification);
    io.to(clients.get(draft.creatorId)).emit('draft', draft);
    draft.campaign.campaignAdmin.forEach(async (item: any, index: any) => {
      const draftNoti = await saveNotification(
        item.admin.user.id,
        Title.Create,
        `There's new draft from ${draft.creator.name} for campaign ${draft.campaign.name}`,
        Entity.Campaign,
      );

      io.emit('notification', draftNoti);
    });
    (await channel).ack(data as any);
  });
})();
