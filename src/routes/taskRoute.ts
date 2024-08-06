import { fork } from 'child_process';
import { Router } from 'express';

import {
  adminManageAgreementSubmission,
  creatorUploadAgreement,
  getSubmissionByCampaignCreatorId,
} from 'src/controller/tasksController';

import { isLoggedIn } from 'src/middleware/onlyLogin';
import { isSuperAdmin } from 'src/middleware/onlySuperadmin';
import amqp from 'amqplib';

const router = Router();

router.get('/submissions', isLoggedIn, getSubmissionByCampaignCreatorId);
router.post('/uploadAgreementForm', isLoggedIn, creatorUploadAgreement);
router.patch('/adminManageAgreementSubmission', isSuperAdmin, adminManageAgreementSubmission);

// router.post('/compress', async (req, res) => {
//   const conn = await amqp.connect('amqp://host.docker.internal');
//   const channel = await conn.createChannel();

//   channel.assertQueue('test');

//   channel.sendToQueue('test', Buffer.from('Hello'), { persistent: true });

//   // const video = (req?.files as any)?.video;
//   // if (video) {
//   //   const child = fork('src/helper/video.ts');
//   //   child.send({ tempFilePath: video.tempFilePath, name: video.name });
//   //   child.on('message', (message: { statusCode: number; text: string }) => {
//   //     console.log(message);
//   //     const { statusCode, text } = message;
//   //     if (statusCode) {
//   //       res.status(statusCode).send(text);
//   //     }
//   //   });
//   // } else {
//   //   return res.status(400).send('No file is uploaded');
//   // }
// });

export default router;
