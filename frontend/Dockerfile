FROM node:20-slim
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY api/package.json ./api/package.json
COPY workers/package.json ./workers/package.json
COPY bots/package.json ./bots/package.json
COPY frontend/package.json ./frontend/package.json
RUN npm ci
RUN if [ "$(uname -m)" = "aarch64" ]; then npm install --no-save @rollup/rollup-linux-arm64-gnu; fi
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=@stockey/frontend", "--", "--host", "0.0.0.0"]
