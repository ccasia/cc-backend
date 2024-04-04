import express, { Request, Response, Application } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import morgan from 'morgan';
import { router } from '@routes/index';

dotenv.config();

const app: Application = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  cors({
    origin: 'http:localhost:81',
  }),
);
app.use(morgan('combined'));
app.disable('x-powered-by');

app.use(router);

app.get('/', (_req: Request, res: Response) => {
  res.send('Server is running...');
});

app.listen(process.env.PORT, () => {
  console.log(`Listening to port ${process.env.PORT}...`);
});
