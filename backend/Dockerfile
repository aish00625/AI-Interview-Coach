# Development image for the Express API. Not production-hardened.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /data/resumes && chown -R node:node /data /app
USER node
EXPOSE 5000
CMD ["node", "server.js"]
