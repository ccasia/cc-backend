import express, { Request, Response, Application } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { router } from '@routes/index';
import session from 'express-session';
import pg from 'pg';
import cookieParser from 'cookie-parser';
import connectPgSimple from 'connect-pg-simple';
import fileUpload from 'express-fileupload';
import { PrismaClient } from '@prisma/client';
import passport from 'passport';
import '@configs/cronjob';
import http from 'http';
import { markMessagesAsSeen } from '@controllers/threadController';
import { handleSendMessage, fetchMessagesFromThread } from '@services/threadService';
import { isLoggedIn } from '@middlewares/onlyLogin';
import { Server, Socket } from 'socket.io';
import '@services/uploadVideo';
import './helper/videoDraft';
import './helper/videoDraftWorker';
import './helper/processPitchVideo';
import dotenv from 'dotenv';
import '@services/google_sheets/sheets';
import { accessGoogleSheetAPI, createNewRowData, createNewSpreadSheet } from '@services/google_sheets/sheets';
import { status } from '@dotenvx/dotenvx';
import path from 'path';
import fse from 'fs-extra';

import Ffmpeg from 'fluent-ffmpeg';
import FfmpegPath from '@ffmpeg-installer/ffmpeg';

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
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  fileUpload({
    // limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/',
    // debug: true,
  }),
);

const corsOptions = {
  origin: true, //included origin as true
  credentials: true, //included credentials as true
};

app.use(cors(corsOptions));
app.use(morgan('combined'));
app.disable('x-powered-by');

// create the session here
declare module 'express-session' {
  interface SessionData {
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

// store session in PostgreSQL
const pgSession = connectPgSimple(session);

const pgPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET as string,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000, //expires in 24hours
  },
  store: new pgSession({
    pool: pgPool,
    tableName: 'session',
  }),
});

app.use(sessionMiddleware);

io.use((socket: Socket, next: any) => {
  return sessionMiddleware(socket.request as any, {} as any, next as any);
});

app.use(passport.initialize());

app.use(passport.session());

app.use(router);

app.get('/', (_req: Request, res: Response) => {
  res.send(`${process.env.NODE_ENV} is running...`);
});

app.get('/users', isLoggedIn, async (_req, res) => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany();
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
    const { submissionId } = data;

    if (activeProcesses.has(submissionId)) {
      const command = activeProcesses.get(submissionId);
      command.kill('SIGKILL'); // Terminate the FFmpeg process
      activeProcesses.delete(submissionId);

      socket.emit('progress', { submissionId, progress: 0 }); // Reset progress
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

// app.post('/upload', async (req: Request, res: Response) => {
//   if (!req.files) return res.status(404).json({ message: 'No video file uploaded' });

//   try {
//     const chunkNumber = Number(req.body.chunk);
//     const totalChunks = Number(req.body.totalChunk);
//     const fileName = (req.files as any).video.name.replace(/\s+/, '');

//     await fse.mkdir(uploadPathChunks, { recursive: true });
//     await fse.mkdir(uploadPath, { recursive: true });

//     await fse.copyFile(
//       (req.files as any).video.tempFilePath,
//       path.join(uploadPathChunks, `${fileName}.part-${chunkNumber}`),
//     );

//     const uploadedChunks = fse.readdirSync(uploadPathChunks).filter((file) => file.startsWith(fileName));

//     if (uploadedChunks.length === totalChunks) {
//       const writeStream = fse.createWriteStream(path.join(uploadPath, fileName));

//       for (let i = 0; i < totalChunks; i++) {
//         const chunkPath = path.join(uploadPathChunks, `${fileName}.part-${i}`);

//         const data = await fse.readFile(chunkPath);
//         writeStream.write(data);
//         await fse.unlink(chunkPath);
//       }

//       writeStream.end();

//       const inputPath = path.join(uploadPath, fileName);
//       // const outputPath = path.join(uploadPath, `compressed-${fileName}`);
//       // const compressedPath = `./${inputPath.split('.').slice(0, -1).join('.')}-compressed.mp4`;
//       const compressedPath = path.join(uploadPath, `${fileName.split('.').slice(0, -1).join('.')}-compressed.mp4`);

//       Ffmpeg.ffprobe(inputPath, (err, metadata) => {
//         if (err) {
//           console.error('FFprobe error:', err);
//           return res.status(400).json({ success: false, message: 'Invalid input file' });
//         }
//         console.log('FFprobe metadata:', metadata);
//       });

//       Ffmpeg(inputPath)
//         .output(compressedPath)
//         .outputOptions([
//           '-c:v libx264',
//           '-crf 26',
//           '-pix_fmt yuv420p',
//           '-preset ultrafast',
//           '-map 0:v:0',
//           '-map 0:a:0?',
//           '-threads 4',
//         ])
//         .on('progress', (data) => {
//           console.log(data);
//         })
//         .on('end', () => {
//           // fse.unlinkSync(inputPath); // Optionally delete the original merged file
//           res.json({
//             success: true,
//             message: 'File uploaded, merged, and compressed successfully',
//             compressedPath,
//           });
//         })
//         .on('error', (err) => {
//           console.error('FFmpeg error:', err);
//           res.status(500).json({
//             success: false,
//             message: 'Compression failed',
//             error: err.message,
//           });
//         })
//         .run();
//     } else {
//       return res.status(201).json({ message: 'next chunk' });
//     }
//   } catch (error) {
//     return res.status(400).json(error);
//   }
// });

server.listen(process.env.PORT, () => {
  //console.log(`Listening to port ${process.env.PORT}...`);
  //console.log(`${process.env.NODE_ENV} stage is running...`);
});
