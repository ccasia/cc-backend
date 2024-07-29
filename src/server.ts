import express, { Request, Response, Application } from 'express';
import dotenv from 'dotenv';
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
// import FacebookStrategy from 'passport-facebook';
import 'src/config/cronjob';
import http from 'http';
import { sendMessageInThread, fetchMessagesFromThread } from './controller/threadController';
import { isLoggedIn } from './middleware/onlyLogin';
import { Server, Socket } from 'socket.io';
import 'src/service/uploadVideo';

dotenv.config();

const app: Application = express();
const server = http.createServer(app);
export const io = new Server(server, { connectionStateRecovery: {} });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  fileUpload({
    // limits: { fileSize: 50 * 1024 * 1024 },
    useTempFiles: true,
    tempFileDir: '/tmp/',
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
  }
}

// you have to create a table in PostgreSQL to store the session
// the following command will create the table in PostgreSQL
//  you have to key in the command on each build
//  CREATE TABLE session (
//   sid VARCHAR(255) PRIMARY KEY NOT NULL,
//   sess JSON NOT NULL,
//   expire TIMESTAMP WITH TIME ZONE NOT NULL
// );

// store session in PostgreSQL
const pgSession = connectPgSimple(session);

const pgPool = new pg.Pool({
  user: 'postgres',
  connectionString: process.env.DATABASE_URL,
  host: '127.0.0.1:5431',
  database: 'postgres',
  password: 'postgres',
  port: 5431,
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

// passport.use(
//   new FacebookStrategy.Strategy(
//     {
//       clientID: process.env.APP_ID,
//       clientSecret: process.env.CLIENT_SECRET,
//       callbackURL: 'https://app.cultcreativeasia.com/api/auth/facebook/callback',
//       enableProof: true,

//       profileFields: ['id', 'displayName', 'photos', 'email'], // Optional fields to request
//     } as any,
//     function (accessToken: any, refreshToken: any, profile: any, done: any) {
//       // Save the accessToken and profile information in your database
//       // For now, we will just log it
//       console.log('Access Token:', accessToken);
//       console.log('Profile:', profile);
//       return done(null, profile);
//     },
//   ),
// );

app.use(router);

// app.get(
//   '/auth/facebook',
//   passport.authenticate('facebook', {
//     scope: ['pages_show_list', 'business_management', 'instagram_basic', 'pages_manage_metadata'],
//   }),
// );

// app.get('/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/' }), (req, res) => {
//   // Successful authentication
//   res.redirect('/');
// });

app.get('/', (_req: Request, res: Response) => {
  res.send('Server is running...');
});

app.get('/users', isLoggedIn, async (_req, res) => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany();
    res.send(users);
  } catch (error) {
    console.log(error);
  }
});

app.get('/tiktokOuth', (req: Request, res: Response) => {
  const csrfState = Math.random().toString(36).substring(2);
  res.cookie('csrfState', csrfState, { maxAge: 60000 });

  let url = 'https://www.tiktok.com/v2/auth/authorize/';

  // the following params need to be in `application/x-www-form-urlencoded` format.
  url += `?client_key=${process.env.TIKTOK_CLIENT_KEY}`;
  url += '&scope=user.info.basic,user.info.profile,user.info.stats';
  url += '&response_type=code';
  url += '&redirect_uri=https://app.cultcreativeasia.com/dashboard/user/profile';
  url += '&state=' + csrfState;

  res.json({ url: url });
});

app.post('/tiktok/data', (req: Request, res: Response) => {
  const url = 'https://open.tiktokapis.com/v2/oauth/token/';
});

export const clients = new Map();

io.on('connection', (socket) => {
  socket.on('register', (userId) => {
    clients.set(userId, socket.id);
  });

  // Joins a room for every thread
  socket.on('room', async (threadId: any) => {
    try {
      // Join the room specified by threadId
      socket.join(threadId);
      console.log(`Client joined room: ${threadId}`);

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
  // socket.on('room', (threadId: string) => {
  //   socket.join(threadId);
  //   console.log(`Client joined room : ${threadId}`);
  // });

  // Sends message and saves to database
  socket.on(
    'sendMessage',
    async (message: {
      senderId: string;
      name: string;
      role: string;
      photoURL: string;
      threadId: string;
      content: any;
    }) => {
      const { senderId, threadId, content, role, name, photoURL } = message;

      // Simulate the request and response for calling the API endpoint
      const req = {
        body: {
          threadId,
          content,
        },
        session: {
          userid: senderId,
        },
        app: {
          get: (key: string) => {
            if (key === 'io') return io;
            return null;
          },
        },
      } as unknown as Request;

      const res = {
        status: (code: number) => ({
          json: (data: any) => {
            if (code === 201) {
              console.log('Message saved:', data);
              io.to(threadId).emit('message', {
                senderId,
                threadId,
                content,
                sender: { role, name, photoURL },
                createdAt: new Date().toISOString(),
              });
            } else {
              console.error('Error saving message:', data);
            }
          },
        }),
      } as unknown as Response;

      await sendMessageInThread(req, res);
    },
  );
  // socket.on('sendMessage', (message: { userId: string; threadId: string; text: string }) => {
  //   const { userId, threadId, text } = message;
  //   //Broadcast to thread
  //   io.to(threadId).emit('message', message);
  // });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    clients.forEach((value, key) => {
      if (value === socket.id) {
        clients.delete(key);
        console.log(`Removed user ${key} from clients map`);
      }
    });
  });
  // socket.on('chat', (data: any) => {
  //   const socketId = clients.get('49ade6f0-391f-409a-81ed-2fb780832f6f');
  //   if (socketId) {
  //     socket.to(socketId).emit('message', data);
  //   } else {
  //     console.log('User is not connected');
  //   }
  // });

  // When a user disconnects, remove their socket ID
  //   socket.on('disconnect', () => {
  //     clients.forEach((value, key) => {
  //       if (value === socket.id) {
  //         clients.delete(key);
  //       }
  //     });
  //   });
  // });
  // Handle chat messages

  // Handle disconnection
});

server.listen(process.env.PORT, () => {
  console.log(`Listening to port ${process.env.PORT}...`);
});
