// /* eslint-disable promise/always-return */

// import workerpool from 'workerpool';
// import Ffmpeg from 'fluent-ffmpeg';
// import ffmpegPath from '@ffmpeg-installer/ffmpeg';
// import ffprobePath from '@ffprobe-installer/ffprobe';
// import fs from 'fs';
// import { uploadPitchVideo } from '@configs/cloudStorage.config';
// import amqplib from 'amqplib';
// import { activeProcesses, clients, io } from '../server';
// import { Entity, PrismaClient } from '@prisma/client';
// import { saveNotification } from '@controllers/notificationController';
// import { spawn } from 'child_process';
// import dayjs from 'dayjs';
// import { notificationDraft } from './notification';
// import { createNewTask, getTaskId, updateTask } from '@services/kanbanService';
// import { createNewRowData } from '@services/google_sheets/sheets';

// Ffmpeg.setFfmpegPath(ffmpegPath.path);
// Ffmpeg.setFfprobePath(ffprobePath.path);

// const prisma = new PrismaClient();

// interface VideoData {
//   userid: string;
//   inputPath: string;
//   outputPath: string;
//   submissionId: string;
//   fileName: string;
//   folder: string;
//   caption: string;
//   admins: { admin: { user: { id: string } } }[];
// }

// const processVideo = async (videoData: VideoData): Promise<void> => {
//   return new Promise<void>((resolve, reject) => {
//     const { userid, inputPath, outputPath, submissionId, fileName, folder, caption } = videoData;
//     const command = Ffmpeg(inputPath)
//       .outputOptions([
//         '-c:v libx264',
//         '-crf 26',
//         '-pix_fmt yuv420p',
//         '-preset ultrafast',
//         '-map 0:v:0',
//         '-map 0:a:0?',
//         '-threads 4',
//       ])
//       .save(outputPath)
//       .on('progress', (progress) => {
//         activeProcesses.set(submissionId, command);
//         const percentage = Math.round(progress.percent || 0);
//         io?.to(clients.get(userid)!).emit('progress', {
//           progress: percentage,
//           submissionId,
//           name: 'Compression Start',
//         });
//       })
//       .on('end', async () => {
//         try {
//           const size = (await fs.promises.stat(outputPath)).size;

//           const publicURL = await uploadPitchVideo(
//             outputPath,
//             fileName,
//             folder,
//             (data: number) => {
//               io?.to(clients.get(userid)!).emit('progress', {
//                 progress: data,
//                 submissionId,
//                 name: 'Uploading Start',
//               });
//             },
//             size,
//           );

//           const data = await prisma.submission.update({
//             where: { id: submissionId },
//             data: {
//               content: publicURL,
//               caption,
//               status: 'PENDING_REVIEW',
//               submissionDate: dayjs().toISOString(),
//             },
//             include: {
//               submissionType: true,
//               campaign: {
//                 include: {
//                   campaignAdmin: {
//                     select: {
//                       adminId: true,
//                       admin: { include: { user: { include: { Board: { include: { columns: true } } } } } },
//                     },
//                   },
//                 },
//               },
//               user: { include: { creator: true } },
//             },
//           });

//           if (data.campaign.spreadSheetURL) {
//             const spreadSheetId = data.campaign.spreadSheetURL.split('/d/')[1].split('/')[0];
//             await createNewRowData({
//               creatorInfo: {
//                 name: data.user.name as string,
//                 username: data.user.creator?.instagram as string,
//                 postingDate: dayjs().format('LL'),
//                 caption,
//                 videoLink: `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${data?.submissionType.type}/${data?.id}_draft.mp4?v=${dayjs().toISOString()}`,
//               },
//               spreadSheetId,
//             });
//           }

//           const { title, message } = notificationDraft(data.campaign.name, 'Creator');

//           const notification = await saveNotification({
//             userId: data.userId,
//             message: message,
//             title: title,
//             entity: 'Draft',
//             entityId: data.campaign.id,
//           });

//           io?.to(clients.get(data.userId)).emit('notification', notification);

//           const { title: adminTitle, message: adminMessage } = notificationDraft(
//             data.campaign.name,
//             'Admin',
//             data.user.name as string,
//           );

//           for (const item of data.campaign.campaignAdmin) {
//             const notification = await saveNotification({
//               userId: item.adminId,
//               message: adminMessage,
//               creatorId: userid,
//               title: adminTitle,
//               entity: 'Draft',
//               entityId: data.campaignId,
//             });

//             if (item.admin.user.Board) {
//               const actionNeededColumn = item.admin.user.Board.columns.find((item) => item.name === 'Actions Needed');

//               const taskInDone = await getTaskId({
//                 boardId: item.admin.user.Board.id,
//                 submissionId: data.id,
//                 columnName: 'Done',
//               });

//               if (actionNeededColumn) {
//                 if (taskInDone) {
//                   await updateTask({
//                     taskId: taskInDone.id,
//                     toColumnId: actionNeededColumn.id,
//                     userId: item.admin.user.id,
//                   });
//                 } else {
//                   await createNewTask({
//                     submissionId: data.id,
//                     name: 'Draft Submission',
//                     userId: item.admin.user.id,
//                     position: 1,
//                     columnId: actionNeededColumn.id,
//                   });
//                 }
//               }
//             }

//             if (io) {
//               io.to(clients.get(item.adminId)).emit('notification', notification);
//             }
//           }

//           activeProcesses.delete(submissionId);
//           io?.to(clients.get(userid)!).emit('progress', { submissionId, progress: 100 });
//           await fs.promises.unlink(inputPath);
//           await fs.promises.unlink(outputPath);
//           resolve();
//         } catch (error) {
//           reject(error);
//         }
//       })
//       .on('error', (err) => {
//         console.error('Error processing video:', err);
//         activeProcesses.delete(submissionId);
//         reject(err);
//         fs.unlinkSync(inputPath);
//       });
//   });
// };

// (async () => {
//   try {
//     const conn = await amqplib.connect(process.env.RABBIT_MQ!);
//     const channel = await conn.createChannel();
//     await channel.assertQueue('draft', { durable: true });
//     await channel.purgeQueue('draft');
//     console.log('Consumer 2 Starting...');
//     const startUsage = process.cpuUsage();

//     await channel.consume('draft', async (msg) => {
//       if (msg) {
//         const content: VideoData = JSON.parse(msg.content.toString());
//         await processVideo(content);
//         channel.ack(msg);
//         const endUsage = process.cpuUsage(startUsage);
//         console.log(`CPU Usage: ${endUsage.user} microseconds (user) / ${endUsage.system} microseconds (system)`);

//         for (const item of content.admins) {
//           io.to(clients.get(item.admin.user.id)!).emit('newSubmission');
//         }

//         const allSuperadmins = await prisma.user.findMany({
//           where: {
//             role: 'superadmin',
//           },
//         });

//         for (const admin of allSuperadmins) {
//           io.to(clients.get(admin.id)).emit('newSubmission');
//         }
//       }
//     });
//   } catch (error) {
//     console.error('Error in message queue consumer:', error);
//   }
// })();

/* eslint-disable promise/always-return */

import Ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobePath from '@ffprobe-installer/ffprobe';
import fs from 'fs';
import { uploadPitchVideo, uploadImage } from '@configs/cloudStorage.config';
import amqplib from 'amqplib';
import { activeProcesses, clients, io } from '../server';
import { Entity, PrismaClient, Submission } from '@prisma/client';
import { saveNotification } from '@controllers/notificationController';
import { spawn } from 'child_process';
import path from 'path';

import dayjs from 'dayjs';
import { notificationDraft } from './notification';
import { createNewTask, getTaskId, updateTask } from '@services/kanbanService';
import { createNewRowData } from '@services/google_sheets/sheets';

Ffmpeg.setFfmpegPath(ffmpegPath.path);
Ffmpeg.setFfprobePath(ffprobePath.path);

const prisma = new PrismaClient();

interface VideoFile {
  inputPath: string;
  outputPath: string;
  fileName: string;
}

const processVideo = async (
  content: any,
  inputPath: string,
  outputPath: string,
  submissionId: string,
  fileName: string,
  folder: string,
  caption: string,
) => {
  return new Promise<void>((resolve, reject) => {
    const { userid } = content;
    // const { userid, inputPath, outputPath, submissionId, fileName, folder, caption } = videoData;
    const command = Ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-crf 26',
        '-pix_fmt yuv420p',
        '-preset ultrafast',
        '-map 0:v:0',
        '-map 0:v:0',
        '-map 0:a:0?',
        '-threads 4',
      ])
      .save(outputPath)
      .on('progress', (progress) => {
        activeProcesses.set(submissionId, command);
        const percentage = Math.round(progress.percent as number);
        if (io) {
          io.to(clients.get(userid)).emit('progress', {
            progress: percentage,
            submissionId: submissionId,
            name: 'Compression Start',
            fileName: fileName,
            fileSize: fs.statSync(inputPath).size,
            fileType: path.extname(fileName),
          });
        }
      })
      .on('end', async () => {
        if (io) {
          io.to(clients.get(userid)).emit('progress', {
            progress: 100,
            submissionId: submissionId,
            name: 'Compression Start',
            fileName: fileName,
            fileSize: fs.statSync(inputPath).size,
            fileType: path.extname(fileName),
          });
        }

        // if (fs.existsSync(inputPath)) {
        //   fs.unlinkSync(inputPath);
        // } else {
        //   console.warn(`File not found: ${inputPath}`);
        // }

        resolve();
      })
      .on('error', (err) => {
        console.error('Error processing video:', err);
        activeProcesses.delete(submissionId);
        reject(err);
        // fs.unlinkSync(inputPath);
      });
  });
};

const checkCurrentSubmission = async (submissionId: string) => {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: {
      submissionType: true,
      campaign: true,
      feedback: true,
      video: true,
      rawFootages: true,
      photos: true,
      dependentOn: {
        select: {
          dependentSubmission: {
            select: {
              feedback: true,
              video: true,
              rawFootages: true,
              photos: true,
            },
          },
        },
      },
    },
  });

  if (!submission) throw new Error('Submission not found');

  const user = await prisma.shortListedCreator.findFirst({
    where: {
      userId: submission?.userId,
      campaignId: submission?.campaignId,
    },
    select: {
      ugcVideos: true,
    },
  });

  if (!user) throw new Error('UGC Credits is not assigned to this creator');

  const [videos, rawFootages, photos] = await Promise.all([
    prisma.video.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
    prisma.rawFootage.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
    prisma.photo.count({ where: { userId: submission.userId, campaignId: submission.campaignId } }),
  ]);

  let allDeliverablesSent = false;

  if (submission?.submissionType.type === 'FIRST_DRAFT') {
    const hasVideo = videos === user.ugcVideos;
    const hasRawFootage = submission.campaign.rawFootage ? rawFootages > 0 : true;
    const hasPhotos = submission.campaign.photos ? photos > 0 : true;

    allDeliverablesSent = hasVideo && hasRawFootage && hasPhotos;
  } else if (submission?.submissionType.type === 'FINAL_DRAFT') {
    const [videosWithRevision, rawFootagesWithRevision, photosWithRevision] = await Promise.all([
      prisma.video.count({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          status: 'REVISION_REQUESTED',
        },
      }),
      prisma.rawFootage.count({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          status: 'REVISION_REQUESTED',
        },
      }),
      prisma.photo.count({
        where: {
          userId: submission.userId,
          campaignId: submission.campaignId,
          status: 'REVISION_REQUESTED',
        },
      }),
    ]);

    const hasVideos = videosWithRevision === 0;

    const hasRawFootage = submission.campaign.rawFootage ? rawFootagesWithRevision === 0 : true;

    const hasPhotos = submission.campaign.photos ? photosWithRevision === 0 : true;

    allDeliverablesSent = hasVideos && hasRawFootage && hasPhotos;
  }

  // Update submission status based on deliverable checks
  if (allDeliverablesSent || !submission.campaign.campaignCredits) {
    await prisma.submission.update({
      where: { id: submission.id },
      data: {
        status: 'PENDING_REVIEW',
        submissionDate: dayjs().format(),
      },
    });
  } else {
    if (submission.submissionType.type === 'FIRST_DRAFT') {
      await prisma.submission.update({
        where: { id: submission.id },
        data: {
          status: 'IN_PROGRESS',
        },
      });
    } else {
      await prisma.submission.update({
        where: { id: submission.id },
        data: {
          status: 'CHANGES_REQUIRED',
        },
      });
    }
  }

  if (io) {
    io.to(clients.get(submission.userId)).emit('updateSubmission');
  }
};

async function deleteFileIfExists(filePath: string) {
  try {
    await fs.promises.access(filePath); // Check if file exists
    await fs.promises.unlink(filePath); // Delete the file
    console.log(`Deleted: ${filePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`File does not exist: ${filePath}`);
    } else {
      console.error(`Error deleting file: ${error.message}`);
    }
  }
}

(async () => {
  try {
    const conn = await amqplib.connect(process.env.RABBIT_MQ!);
    const channel = await conn.createChannel();
    await channel.assertQueue('draft', { durable: true });
    // await channel.purgeQueue('draft');

    console.log('Consumer 1 Starting...');
    const startUsage = process.cpuUsage();

    await channel.consume(
      'draft',
      async (msg) => {
        if (msg !== null) {
          const content: any = JSON.parse(msg.content.toString());
          console.log('RECIEVED', content);
          const { filePaths } = content;

          try {
            const submission = await prisma.submission.findUnique({
              where: { id: content.submissionId },
              select: {
                campaignId: true,
                status: true,
                id: true,
                video: true,
                rawFootages: true,
                photos: true,
                submissionType: true,
                userId: true,
                campaign: {
                  select: {
                    rawFootage: true,
                    photos: true,
                    campaignCredits: true,
                  },
                },
                feedback: {
                  select: {
                    videosToUpdate: true,
                  },
                },
              },
            });

            if (!submission) throw new Error('Submission not found');

            const requestChangeVideos = await prisma.video.findMany({
              where: {
                userId: submission.userId,
                campaignId: submission.campaignId,
                status: 'REVISION_REQUESTED',
              },
            });

            // For videos
            if (filePaths?.video?.length) {
              const videoPromises = filePaths.video.map(async (videoFile: VideoFile, index: any) => {
                console.log(`Processing video ${videoFile.fileName}`);

                // Process video
                await processVideo(
                  content,
                  videoFile.inputPath,
                  videoFile.outputPath,
                  submission.id,
                  videoFile.fileName,
                  content.folder,
                  content.caption,
                );

                const { size } = await fs.promises.stat(videoFile.outputPath);

                // // Upload processed video
                const videoPublicURL = await uploadPitchVideo(
                  videoFile.outputPath,
                  videoFile.fileName,
                  content.folder,
                  (data: number) => {
                    io?.to(clients.get(content.userid)!).emit('progress', {
                      progress: Math.ceil(data),
                      submissionId: submission.id,
                      name: 'Uploading Start',
                      fileName: videoFile.fileName,
                      fileSize: fs.statSync(videoFile.outputPath).size,
                      fileType: path.extname(videoFile.fileName),
                    });
                  },
                  size,
                );

                // await deleteFileIfExists(videoFile.outputPath);

                // await fs.promises.unlink(videoFile.outputPath);

                if (!requestChangeVideos.length) {
                  await prisma.video.create({
                    data: {
                      url: videoPublicURL,
                      submissionId: submission.id,
                      campaignId: submission.campaignId,
                      userId: submission.userId,
                    },
                  });
                }

                return videoPublicURL;
              });

              // Wait for all videos to be processed
              const url = await Promise.all(videoPromises);

              if (requestChangeVideos.length) {
                await Promise.all(
                  requestChangeVideos.map((video, index) =>
                    prisma.video.update({
                      where: { id: video.id },
                      data: {
                        url: url[index],
                        submissionId: submission.id,
                        campaignId: content.campaignId,
                        userId: submission.userId,
                        status: 'PENDING',
                      },
                    }),
                  ),
                );
              }

              const data = await prisma.submission.update({
                where: {
                  id: submission.id,
                },
                data: {
                  caption: content.caption,
                  submissionDate: dayjs().format(),
                  ...(!submission.campaign.campaignCredits && { content: url[0] }),
                },
                include: {
                  submissionType: true,
                  campaign: {
                    include: {
                      campaignAdmin: {
                        select: {
                          adminId: true,
                          admin: {
                            select: {
                              user: {
                                select: {
                                  Board: {
                                    include: {
                                      columns: true,
                                    },
                                  },
                                  id: true,
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                  user: { include: { creator: true } },
                },
              });

              if (data.campaign.spreadSheetURL) {
                const spreadSheetId = data.campaign.spreadSheetURL.split('/d/')[1].split('/')[0];

                for (const item of url) {
                  await createNewRowData({
                    creatorInfo: {
                      name: data.user.name as string,
                      username: data.user.creator?.instagram as string,
                      postingDate: dayjs().format('LL'),
                      caption: content.caption,
                      videoLink: item,
                    },
                    spreadSheetId,
                  });
                }

                // await createNewRowData({
                //   creatorInfo: {
                //     name: data.user.name as string,
                //     username: data.user.creator?.instagram as string,
                //     postingDate: dayjs().format('LL'),
                //     caption: content.caption,
                //     videoLink: `https://storage.googleapis.com/${process.env.BUCKET_NAME}/${data?.submissionType.type}/${
                //       data?.id
                //     }_draft.mp4?v=${dayjs().toISOString()}`,
                //   },
                //   spreadSheetId,
                // });
              }

              const { title, message } = notificationDraft(data.campaign.name, 'Creator');

              const notification = await saveNotification({
                userId: data.userId,
                message: message,
                title: title,
                entity: 'Draft',
                entityId: data.campaign.id,
              });

              io?.to(clients.get(data.userId)).emit('notification', notification);

              const { title: adminTitle, message: adminMessage } = notificationDraft(
                data.campaign.name,
                'Admin',
                data.user.name as string,
              );

              for (const item of data.campaign.campaignAdmin) {
                const notification = await saveNotification({
                  userId: item.adminId,
                  message: adminMessage,
                  creatorId: content.userId,
                  title: adminTitle,
                  entity: 'Draft',
                  entityId: data.campaignId,
                });

                if (item.admin.user.Board) {
                  const actionNeededColumn = item.admin.user.Board.columns.find(
                    (item) => item.name === 'Actions Needed',
                  );

                  const taskInDone = await getTaskId({
                    boardId: item.admin.user.Board.id,
                    submissionId: data.id,
                    columnName: 'Done',
                  });

                  if (actionNeededColumn) {
                    if (taskInDone) {
                      await updateTask({
                        taskId: taskInDone.id,
                        toColumnId: actionNeededColumn.id,
                        userId: item.admin.user.id,
                      });
                    } else {
                      await createNewTask({
                        submissionId: data.id,
                        name: 'Draft Submission',
                        userId: item.admin.user.id,
                        position: 1,
                        columnId: actionNeededColumn.id,
                      });
                    }
                  }
                }

                if (io) {
                  io.to(clients.get(item.adminId)).emit('notification', notification);
                }
              }

              activeProcesses.delete(submission.id);
            }

            //For Raw Footages
            if (filePaths?.rawFootages?.length) {
              const requestChangeRawFootages = await prisma.rawFootage.findMany({
                where: {
                  userId: submission.userId,
                  campaignId: submission.campaignId,
                  status: 'REVISION_REQUESTED',
                },
              });

              const urls = await Promise.all(
                filePaths.rawFootages.map(async (rawFootagePath: any) => {
                  const rawFootageFileName = `${submission.id}_${path.basename(rawFootagePath)}`;

                  const { size } = await fs.promises.stat(rawFootagePath);

                  const rawFootagePublicURL = await uploadPitchVideo(
                    rawFootagePath,
                    rawFootageFileName,
                    content.folder,
                    (data: number) => {
                      io?.to(clients.get(content.userid)!).emit('progress', {
                        progress: Math.ceil(data),
                        submissionId: submission.id,
                        name: 'Uploading Start',
                        fileName: rawFootageFileName,
                        fileSize: fs.statSync(rawFootagePath).size,
                        fileType: path.extname(rawFootagePath),
                      });
                    },
                    size,
                  );

                  if (!requestChangeRawFootages.length) {
                    await prisma.rawFootage.create({
                      data: {
                        url: rawFootagePublicURL,
                        submissionId: submission.id,
                        campaignId: content.campaignId,
                        userId: submission.userId,
                      },
                    });
                  }

                  return rawFootagePublicURL;
                }),
              );

              if (requestChangeRawFootages.length) {
                await Promise.all(
                  requestChangeRawFootages.map((video, index) =>
                    prisma.rawFootage.update({
                      where: { id: video.id },
                      data: {
                        url: urls[index],
                        submissionId: submission.id,
                        campaignId: content.campaignId,
                        userId: submission.userId,
                        status: 'PENDING',
                      },
                    }),
                  ),
                );
              }
            }

            // For photos
            if (filePaths?.photos?.length) {
              const requestChangePhotos = await prisma.photo.findMany({
                where: {
                  userId: submission.userId,
                  campaignId: submission.campaignId,
                  status: 'REVISION_REQUESTED',
                },
              });

              const urls = await Promise.all(
                filePaths.photos.map(async (photoPath: any) => {
                  const photoFileName = `${submission.id}_${path.basename(photoPath)}`;
                  const photoPublicURL = await uploadImage(photoPath, photoFileName, content.folder);

                  if (!requestChangePhotos.length) {
                    await prisma.photo.create({
                      data: {
                        url: photoPublicURL,
                        submissionId: submission.id,
                        campaignId: content.campaignId,
                        userId: submission.userId,
                      },
                    });
                  }
                  // await fs.promises.unlink(photoPath);

                  console.log('✅ Photo entry created in the DB.');
                  return photoPublicURL;
                }),
              );

              if (requestChangePhotos.length) {
                await Promise.all(
                  requestChangePhotos.map((photo, index) =>
                    prisma.photo.update({
                      where: { id: photo.id },
                      data: {
                        url: urls[index],
                        submissionId: submission.id,
                        campaignId: content.campaignId,
                        userId: submission.userId,
                        status: 'PENDING',
                      },
                    }),
                  ),
                );
              }
            }

            await checkCurrentSubmission(submission.id);

            const endUsage = process.cpuUsage(startUsage);

            console.log(`CPU Usage: ${endUsage.user} microseconds (user) / ${endUsage.system} microseconds (system)`);

            for (const item of content.admins) {
              io.to(clients.get(item.admin.user.id)).emit('newSubmission');
            }

            const allSuperadmins = await prisma.user.findMany({
              where: {
                role: 'superadmin',
              },
            });

            for (const admin of allSuperadmins) {
              io.to(clients.get(admin.id)).emit('newSubmission');
            }
          } catch (error) {
            console.error('Error processing submission:', error);
          } finally {
            channel.ack(msg);
          }
        }
      },
      {
        noAck: false,
      },
    );
  } catch (error) {
    console.error('Worker error:', error);
    throw error;
  }
})();
