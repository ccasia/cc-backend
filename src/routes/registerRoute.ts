import express from 'express';
import { register } from 'src/controller/registerController';

const routes = express.Router();

routes.post('/register', register);

export default routes;
