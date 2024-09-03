# STAGE 1 - BUILDING THE CODE
FROM node:20-alpine3.17 AS base
RUN apk add --no-cache \
    libreoffice \
    ttf-dejavu \
    fontconfig \
    && rm -rf /var/cache/apk/*
WORKDIR /app
COPY package.json ./
COPY yarn.lock ./

FROM base AS development
ENV NODE_ENV=development
RUN yarn install --production=false
COPY . .
RUN yarn global add prisma
RUN npx prisma generate
EXPOSE 3001
CMD [ "yarn", "dev" ]


# Stage 2 - Builder
FROM node as builder
WORKDIR /app
COPY package.json ./
COPY yarn.lock ./
COPY --from=development /app ./
RUN yarn build

# Stage 3 - Compiled
FROM node as staging
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY yarn.lock ./
RUN yarn deploy

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD [ "yarn", "prod:prev" ]