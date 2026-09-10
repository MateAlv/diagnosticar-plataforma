# syntax=docker/dockerfile:1.7

# Node 18 reached end of life in April 2025 and no longer receives security
# patches; CI, the frontend image and package.json engines all target 22.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` installs exactly the audited lockfile — `npm install` can silently
# resolve something CI never checked.
RUN npm ci

FROM deps AS builder
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Production dependencies only: dev tooling in a running container is extra
# attack surface for no benefit.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder --chown=node:node /app/dist ./dist

EXPOSE 4000
# Never run as root — CI asserts this.
USER node
CMD ["node", "dist/index.js"]
