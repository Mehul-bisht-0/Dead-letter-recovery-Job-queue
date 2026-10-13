FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && npm run build && npm prune --omit=dev && node scripts/prepare-runtime.mjs

FROM node:24-slim AS runner
WORKDIR /app
ARG PACKAGE_NAME=api
ENV NODE_ENV=production
ENV RUN_PACKAGE=${PACKAGE_NAME}
COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/runtime/packages ./packages
USER node
CMD ["sh", "-c", "case \"$RUN_PACKAGE\" in api|dashboard) exec node packages/$RUN_PACKAGE/dist/server.js ;; worker|dispatcher) exec node packages/$RUN_PACKAGE/dist/index.js ;; *) exit 64 ;; esac"]
