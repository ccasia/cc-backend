import express, { Request, Response, Application } from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";

dotenv.config();

const app: Application = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());
app.use(morgan("combined"));

app.get("/test", (req: Request, res: Response) => {
  res.send("HA");
});

app.listen(process.env.PORT, () => {
  console.log(`Listening to port ${process.env.PORT}...`);
});
