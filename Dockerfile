# Multi-stage Dockerfile for reliable-queue packages
# Build context should be the monorepo root.
# Usage: docker build -f packages/api/Dockerfile -t reliable-queue-api .

# --- Stage 1: Build ---
FROM node:20-slim AS builder
WORKDIR /app

# Copy root configs and package.json files
COPY package.json package-lock.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/api/package.json ./packages/api/
COPY packages/worker/package.json ./packages/worker/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/loadtest/package.json ./packages/loadtest/

# Install all dependencies (dev + prod) to build
RUN npm ci

# Copy source code
COPY packages/core/src ./packages/core/src
COPY packages/core/tsconfig.json ./packages/core/

# Allow overriding which package to build/run via build arg
ARG PACKAGE_NAME=api
COPY packages/${PACKAGE_NAME}/src ./packages/${PACKAGE_NAME}/src
COPY packages/${PACKAGE_NAME}/tsconfig.json ./packages/${PACKAGE_NAME}/
# Copy dashboard public files if they exist
COPY packages/dashboard/public ./packages/dashboard/public

# We're using tsx for development/running directly instead of compiling tsc
# so we don't strictly need a build step for TS if we use tsx in production, 
# but for a true prod-grade setup, we compile.
RUN npx tsc -b packages/core packages/${PACKAGE_NAME}

# --- Stage 2: Runtime ---
FROM node:20-slim AS runner
WORKDIR /app

ARG PACKAGE_NAME=api
ENV NODE_ENV=production
ENV RUN_PACKAGE=${PACKAGE_NAME}

# Copy compiled files and dependencies
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
# Copy the Lua scripts (they don't get compiled by tsc)
COPY --from=builder /app/packages/core/src/lua ./packages/core/dist/lua
COPY --from=builder /app/packages/core/src/schema.sql ./packages/core/dist/

COPY --from=builder /app/packages/${PACKAGE_NAME}/dist ./packages/${PACKAGE_NAME}/dist
COPY --from=builder /app/packages/${PACKAGE_NAME}/package.json ./packages/${PACKAGE_NAME}/

# Copy dashboard static files if applicable
COPY --from=builder /app/packages/dashboard/public ./packages/dashboard/public

CMD node ./packages/${RUN_PACKAGE}/dist/server.js
