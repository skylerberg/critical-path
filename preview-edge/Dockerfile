FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY index.ts tsconfig.json ./
RUN pnpm run build
# See the api Dockerfile: a second --prod install, not a prune.
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.mjs"]
