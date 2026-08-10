# Bot Service Dockerfile
# Purpose: build a container for the standalone market simulation process.
# The bot service is intentionally separate from the API so it can be scaled
# independently and does not share the API's lifecycle.
FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests first for efficient layer caching.
COPY package.json ./
COPY package-lock.json ./
COPY api/package.json ./api/package.json
COPY workers/package.json ./workers/package.json
COPY bots/package.json ./bots/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci

# Copy the full source tree.
COPY . .

# Run the bot service.
CMD ["npm", "run", "start", "--workspace=@stockey/bots"]