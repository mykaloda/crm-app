FROM node:22-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/mcp/package.json apps/mcp/
RUN pnpm install --frozen-lockfile --filter "@agentmatch/mcp..."
COPY packages/shared packages/shared
COPY apps/mcp apps/mcp
RUN pnpm --filter @agentmatch/shared build && pnpm --filter @agentmatch/mcp build
WORKDIR /app/apps/mcp
ENV NODE_ENV=production
EXPOSE 4100
CMD ["node", "dist/main.js"]
