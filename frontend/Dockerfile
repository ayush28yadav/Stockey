FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY api/package.json ./api/package.json
COPY workers/package.json ./workers/package.json
COPY bots/package.json ./bots/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=@stockey/frontend", "--", "--host", "0.0.0.0"]
