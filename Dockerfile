# Use an official Node runtime as the base image
FROM node:20-alpine3.17 as builder

# Set the working directory in the container
WORKDIR /app

# Copy package.json and yarn.lock files
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the rest of the application code
COPY . .
# Generate Prisma client
RUN npx prisma generate
# Build the application
RUN yarn build

# Start a new stage for a smaller production image
FROM node:20-alpine3.17

WORKDIR /app

# Copy only necessary files from the builder stage
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

# Expose the port the app runs on (adjust if necessary)
EXPOSE 3001

# Command to run the application
CMD ["yarn", "prod:prev"]
