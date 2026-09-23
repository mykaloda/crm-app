FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@agentmatch/api..."
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @agentmatch/shared build && pnpm --filter @agentmatch/api build
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 4000
# Apply migrations, then start. Seed separately: docker compose exec api node -r @swc-node/register src/seed/seed.ts
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
