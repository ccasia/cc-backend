FROM node:20-alpine3.17 AS development

WORKDIR /app

COPY package.json ./
#COPY yarn.lock ./

RUN yarn install

COPY . .

EXPOSE 3001

CMD [ "yarn", "dev" ]
