# Build stage
FROM node:20-alpine3.17 AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source files
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN yarn build

# Production stage
FROM node:20-alpine3.17 AS production
ENV NODE_ENV=production
WORKDIR /app

# Define build argument
ARG DATABASE_URL

# Set environment variable
ENV DATABASE_URL=$DATABASE_URL

# Copy package files and install production dependencies
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copy built files and necessary folders
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Generate Prisma client in production environment
RUN npx prisma generate

# Run database migrations
RUN yarn deploy

EXPOSE 3001

# Use node to run the built app.js file
CMD ["node", "dist/server.js"]