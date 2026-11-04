FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p artifacts && chown -R pwuser:pwuser /app
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4174 ARTIFACTS_DIR=/tmp/break-it BREAKIT_RENDER_CONCURRENCY=1
USER pwuser
EXPOSE 4174
CMD ["npm", "start"]
