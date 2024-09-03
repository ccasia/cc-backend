# Build stage
FROM node:20-alpine3.17 AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy source files, including .env
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

# Copy package files and install production dependencies
COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

# Copy built files and necessary folders
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/.env ./.env

# Update DATABASE_URL in .env file
RUN if [ -n "$DATABASE_URL" ]; then \
    sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" .env; \
    fi

# Generate Prisma client in production environment
RUN npx prisma generate

# Run database migrations
RUN yarn deploy

EXPOSE 3001

# Debug: Show the final directory structure (excluding node_modules)
RUN echo "Final directory structure (excluding node_modules):" && \
    find /app -not -path "*/node_modules/*" -not -name "node_modules"

# Debug: Check file permissions
RUN ls -l /app/dist/server.js

# Debug: Print current working directory
RUN pwd

WORKDIR /app/dist

# Use node to run the built app.js file
CMD ["node", "server.js"]