FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@8.8.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:api
RUN pnpm --filter api --prod deploy /prod/api

FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    PORT=8787 \
    DATABASE_PATH=/data/diy-nav.sqlite \
    BACKUP_DIR=/backups

WORKDIR /app
COPY --from=builder --chown=node:node /prod/api .
RUN mkdir -p /data /backups \
  && chown -R node:node /data /backups /app

VOLUME ["/data", "/backups"]
EXPOSE 8787
USER node

CMD ["node", "dist/server.js"]
