# syntax=docker/dockerfile:1.7

# Node 18 reached end of life in April 2025 and no longer receives security
# patches; CI, the frontend image and package.json engines all target 22.
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` installs exactly the audited lockfile — `npm install` can silently
# resolve something CI never checked.
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:26-alpine AS runner
# The base image lags Alpine's security updates; without this the image ships
# known-vulnerable openssl and the CI scan fails.
RUN apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production
# Recorded at build time so the running container can report which release it
# is. /api/admin/release reads these; unset means "not built by the release
# workflow", which is itself worth knowing.
ARG RELEASE_VERSION=dev
ARG RELEASE_COMMIT=unknown
ARG RELEASE_BUILT_AT=unknown
ENV RELEASE_VERSION=$RELEASE_VERSION \
    RELEASE_COMMIT=$RELEASE_COMMIT \
    RELEASE_BUILT_AT=$RELEASE_BUILT_AT
# Production dependencies only: dev tooling in a running container is extra
# attack surface for no benefit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder --chown=node:node /app/dist ./dist

EXPOSE 4000
# Never run as root — CI asserts this.
USER node
CMD ["node", "dist/index.js"]
