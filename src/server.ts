import express, { Request, Response, Application } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import { router } from '@routes/index';
import session from 'express-session';
import pg from 'pg';
import connectPgSimple from 'connect-pg-simple';
import cookieParser from 'cookie-parser';

dotenv.config();

const app: Application = express();
const name = 'mohand';
console.log(name);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// const corsOptions = {
//   origin: true, //included origin as true
//   credentials: true, //included credentials as true
// };

// app.use(cors(corsOptions));
app.use(cors());
app.use(morgan('combined'));
app.disable('x-powered-by');

// create the session here
declare module 'express-session' {
  interface SessionData {
    userid: string;
    accessToken: string;
    role: string;
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

app.use('/api', router);

app.get('/', (_req: Request, res: Response) => {
  res.send('Server is running...');
});

app.listen(process.env.PORT, () => {
  console.log(`Listening to port ${process.env.PORT}...`);
});
