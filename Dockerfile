FROM node:20-alpine3.17 AS development

WORKDIR /app

COPY package.json ./
#COPY yarn.lock ./

COPY ../../test-cs.json /app/test-cs.json

ENV GOOGLE_APPLICATION_CREDENTIALS=/app/test-cs.json

RUN yarn install

COPY . .

EXPOSE 3001

CMD [ "yarn", "dev" ]
