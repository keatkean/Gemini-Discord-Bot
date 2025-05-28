# Use Node.js base image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json first (to leverage caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the project files
COPY . .

# Copy the environment file (example.env) into the container
COPY example.env /app/.env

# Expose the port (if your bot uses a web server, otherwise omit this line)
EXPOSE 3000

# Clear old bot instances and start a new one
CMD ["sh", "-c", "docker stop pem-pal-disc-bot || true && docker rm pem-pal-disc-bot || true && node index.js"]

