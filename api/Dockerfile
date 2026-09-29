FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
RUN npm install -g pnpm@11.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# No scripts/ copied in, and none needed: pnpm runs this project's own `prepare`
# during every `pnpm install` here — --frozen-lockfile and --prod included — and
# that script tests for ../scripts/setup-hooks.mjs before running it. The build
# context is api/, so a repository-root path is not in it at all; the test is
# what turns that into a no-op instead of a MODULE_NOT_FOUND that fails the image.
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm run build:prod
# A --prod install over the existing tree only unlinks the devDependencies from the top
# level; every one of them stays in node_modules/.pnpm and would ship. Starting from an
# empty node_modules is what leaves them out. --offline relinks from the store the first
# install filled, and fails rather than re-downloading if that store is ever gone.
RUN rm -rf node_modules && pnpm install --frozen-lockfile --prod --offline

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
