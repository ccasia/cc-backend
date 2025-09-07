import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { router } from '@routes/index';
import session from 'express-session';

import cookieParser from 'cookie-parser';

import fileUpload from 'express-fileupload';
import { PrismaClient } from '@prisma/client';

import '@configs/cronjob';
import http from 'http';
import { markMessagesAsSeen } from '@controllers/threadController';
import { handleSendMessage, fetchMessagesFromThread } from '@services/threadService';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Server } from 'socket.io';
import '@services/uploadVideo';

import '@helper/processPitchVideo';
import './helper/videoDraft';
import './helper/videoDraftWorker';

import dotenv from 'dotenv';
import '@services/google_sheets/sheets';
import path from 'path';
import fse from 'fs-extra';

import { PrismaSessionStore } from '@quixo3/prisma-session-store';

import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';
import { storage } from '@configs/cloudStorage.config';
import dayjs from 'dayjs';
import passport from 'passport';

import amqplib from 'amqplib';

Ffmpeg.setFfmpegPath(FfmpegPath.path);

dotenv.config();

const uploadPath = path.join(__dirname, 'uploads');
const uploadPathChunks = path.join(__dirname, 'chunks');

const app: Application = express();
const server = http.createServer(app);

export const io = new Server(server, {
  connectionStateRecovery: {},
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  fileUpload({
    limits: { fileSize: 500 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/',
  }),
);

const corsOptions = {
  origin: true, //included origin as true
  credentials: true, //included credentials as true
};

app.use(cors());

app.use(morgan('combined'));
app.disable('x-powered-by');

// app.set('trust proxy', true);

// create the session here
declare module 'express-session' {
  interface Session {
    userid: string;
    refreshToken: string;
    name: string;
    role: string;
    photoURL: string;
    xeroToken: any;
    xeroTokenid: any;
    xeroTokenSet: any;
    xeroTenants: any;
    xeroActiveTenants: any;
  }
}

// app.set('trust proxy', true);

app.use(
  session({
    secret: process.env.SESSION_SECRET as string,
    resave: false,
    saveUninitialized: false,
    proxy: process.env.NODE_ENV === 'production',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000, //expires in 24hours
      httpOnly: true,
    },
    store: new PrismaSessionStore(new PrismaClient(), {
      checkPeriod: 2 * 60 * 1000,
      dbRecordIdIsSessionId: true,
      dbRecordIdFunction: undefined,
    }),
  }),
);

app.use(passport.initialize());
app.use(passport.session());

app.use(router);

app.get('/', (req: Request, res: Response) => {
  res.send(`Your IP is ${req.ip}. ${process.env.NODE_ENV} is running...`);
});

app.get('/users', isLoggedIn, async (_req, res) => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      include: {
        pitch: true,
      },
    });
    res.send(users);
  } catch (error) {
    //console.log(error);
  }
});

export const clients = new Map();
export const activeProcesses = new Map();
export const queue = new Map();

io.on('connection', (socket) => {
  io.emit('onlineUsers', { onlineUsers: clients.size });
  socket.on('register', (userId) => {
    clients.set(userId, socket.id);
  });

  socket.on('online-user', () => {
    io.emit('onlineUsers', { onlineUsers: clients.size });
  });

  socket.on('cancel-processing', (data) => {
    // const { submissionId } = data;
    const { fileName } = data;

    if (activeProcesses.has(fileName)) {
      const { command, outputPath, inputPath } = activeProcesses.get(fileName);
      // const command = activeProcesses.get(fileName);
      command.kill('SIGKILL'); // Terminate the FFmpeg process
      activeProcesses.delete(fileName);

      const existsOutputPath = fse.pathExistsSync(outputPath);
      const existsInputPath = fse.pathExistsSync(inputPath);

      if (existsOutputPath) {
        fse.unlinkSync(outputPath);
      }

      if (existsInputPath) {
        fse.unlinkSync(inputPath);
      }

      // socket.emit('progress', { file, progress: 0 }); // Reset progress
    }
  });

  socket.on('checkQueue', (data) => {
    if (activeProcesses.has(data?.submissionId)) {
      const item = activeProcesses.get(data.submissionId);
      if (item?.status === 'queue') {
        socket.emit('statusQueue', { status: 'queue' });
      }
    }
  });

  // Joins a room for every thread
  socket.on('room', async (threadId: any) => {
    try {
      // Join the room specified by threadId
      socket.join(threadId);
      //console.log(`Client joined room: ${threadId}`);

      // Fetch old messages using the service
      const oldMessages = await fetchMessagesFromThread(threadId);

      // Emit old messages to the client
      socket.emit('existingMessages', { threadId, oldMessages });
    } catch (error) {
      console.error('Error fetching messages:', error);

      // Optionally, emit an error event to the client
      socket.emit('error', 'Failed to fetch messages');
    }
  });
  // Sends message and saves to database
  socket.on('sendMessage', async (message) => {
    await handleSendMessage(message, io);
    io.to(message.threadId).emit('latestMessage', message);
  });

  socket.on('markMessagesAsSeen', async ({ threadId, userId }) => {
    if (!userId) {
      socket.emit('error', 'User not authenticated.');
      return;
    }

    try {
      const mockRequest = {
        params: { threadId },
        session: { userid: userId },
        cookies: {},
        headers: {},
      } as unknown as Request;

      await markMessagesAsSeen(mockRequest, {} as Response);
      io.to(threadId).emit('messagesSeen', { threadId, userId });
    } catch (error) {
      console.error('Error marking messages as seen:', error);
      socket.emit('error', 'Failed to mark messages as seen.');
    }
  });

  socket.on('disconnect', () => {
    //console.log('Client disconnected:', socket.id);
    clients.forEach((value, key) => {
      if (value === socket.id) {
        clients.delete(key);
      }
    });
    io.emit('onlineUsers', { onlineUsers: clients.size });
  });
});

const bucket = storage.bucket(process.env.BUCKET_NAME as string);

app.post('/video', async (req: Request, res: Response) => {
  const urls: string[] = [];

  try {
    const videos = (req.files as any).rawFootages;

    if (videos.length) {
      for (const video of videos) {
        let uploadedBytes = 0;
        const { tempFilePath, name, mimetype, data, size } = video;

        if (size > 100 * 1024 * 1024) {
          return res.status(404).json({ message: 'File size too large' });
        }

        const readStream = fse.createReadStream(tempFilePath);

        const blob = bucket.file(`videos/${dayjs().format()}-${name}`);

        const totalBytes = fse.statSync(tempFilePath).size;

        const blobStream = blob.createWriteStream({
          resumable: false,
          contentType: mimetype,
        });

        readStream.on('data', (chunk) => {
          uploadedBytes += chunk.length;
          const percentage = Math.round((uploadedBytes / totalBytes) * 100);
          io.emit('uploadProgress', { name: name, percentage });
        });

        await new Promise<void>((resolve, reject) => {
          readStream
            .pipe(blobStream)
            .on('error', (err) => {
              console.error('Error uploading to GCS:', err);
              reject('Failed to upload file.');
            })
            .on('finish', async () => {
              await blob.makePublic();
              const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
              urls.push(publicUrl);
              fse.unlinkSync(tempFilePath); // Cleanup temp file
              resolve();
            });
        });
      }
    } else {
      let uploadedBytes = 0;
      const { tempFilePath, name, mimetype, data, size } = videos;

      if (size > 100 * 1024 * 1024) {
        return res.status(404).json({ message: 'File size too large' });
      }

      const readStream = fse.createReadStream(tempFilePath);

      const blob = bucket.file(`videos/${dayjs().format()}-${name}`);

      const totalBytes = fse.statSync(tempFilePath).size;

      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: mimetype,
      });

      readStream.on('data', (chunk) => {
        uploadedBytes += chunk.length;
        const percentage = Math.round((uploadedBytes / totalBytes) * 100);
        io.emit('uploadProgress', { name: name, percentage });
      });

      await new Promise<void>((resolve, reject) => {
        readStream
          .pipe(blobStream)
          .on('error', (err) => {
            console.error('Error uploading to GCS:', err);
            reject('Failed to upload file.');
          })
          .on('finish', async () => {
            await blob.makePublic();
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${blob.name}`;
            urls.push(publicUrl);
            fse.unlinkSync(tempFilePath); // Cleanup temp file
            resolve();
          });
      });
    }

    return res.status(200).send({ message: 'File uploaded successfully.', url: urls });
  } catch (error) {
    return res.status(400).json(error);
  }
});

app.post('/sendMessage', async (req: Request, res: Response) => {
  let amqp: any;
  let con: any;
  try {
    amqp = await amqplib.connect(process.env.RABBIT_MQ!);

    con = await amqp.createChannel();
    await con.assertQueue('draft', { durable: true });

    con.sendToQueue('draft', Buffer.from(JSON.stringify({ name: req.body.username })), { persistent: true });

    return res.status(200).json({ message: 'Send Sucessfully' });
  } catch (error) {
    return res.status(400).json(error);
  } finally {
    if (con) await con.close();
    if (amqp) await amqp.close();
  }
});

server.listen(process.env.PORT, () => {
  console.log(`Listening to port ${process.env.PORT}...`);
  console.log(`${process.env.NODE_ENV} stage is running...`);

  // draftConsumer();

  // for (let i = 0; i < 2; i++) {
  //   draftConsumer();
  // }
});
