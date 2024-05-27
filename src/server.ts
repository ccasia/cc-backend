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
// import { Storage } from '@google-cloud/storage';

// import { creatorVerificationEmail } from './config/nodemailer.config';

dotenv.config();

const app: Application = express();
// const storage = new Storage({
//   keyFilename: 'src/config/cult-service.json',
// });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(
  fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
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
  host: 'localhost:5435',
  database: 'postgres',
  password: 'postgres',
  port: 5435,
});

app.use(
  session({
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
  }),
);

app.use(router);

app.get('/', (_req: Request, res: Response) => {
  res.send('Server is running...');
});

app.get('/users', async (_req, res) => {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany();
    res.send(users);
  } catch (error) {
    console.log(error);
  }
});

// app.get('/videos/:filename', async (req, res) => {
//   const filename = req.params.filename;
//   const file = storage.bucket('landing-cultcreative').file(`main/${filename}`);

//   try {
//     const [fileExists] = await file.exists();
//     if (!fileExists) {
//       return res.status(404).send('File not found');
//     }

//     // Set proper headers for video streaming
//     res.setHeader('Content-Type', 'video/mp4');
//     res.setHeader('Cache-Control', 'public, max-age=31536000');

//     // Pipe the video stream to the response
//     file.createReadStream().pipe(res);
//   } catch (error) {
//     console.error('Error retrieving file:', error);
//     res.status(500).send('Internal Server Error');
//   }
// });

app.get('/getInstaInformation', (_req: Request, res: Response) => {
  res.send('https://www.instagram.com/apikoll/');
});

app.listen(process.env.PORT, () => {
  console.log(`Listening to port ${process.env.PORT}...`);
});
