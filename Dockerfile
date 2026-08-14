FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Before the install, not after: pnpm runs this project's own `prepare` during
# `pnpm install` — including under --frozen-lockfile and --prod — and prepare is
# `node scripts/setup-hooks.mjs`. Without scripts/ already here the install dies on
# MODULE_NOT_FOUND rather than on anything to do with dependencies.
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm run build:prod
# A second, --prod install rather than a prune: pnpm's own docs steer away from prune,
# and re-resolving against the same frozen lockfile drops the devDependencies for the
# runtime stage below.
RUN pnpm install --frozen-lockfile --prod

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node --from=builder /app/package.json ./package.json
# Every link pnpm writes under node_modules is relative and points inside that tree, so
# copying the directory whole keeps them resolvable.
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src ./src
USER node
EXPOSE 3001
CMD ["node", "dist/index.mjs"]
