# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS deps
ARG NEXT_PUBLIC_MICROIN_URL
ENV NEXT_PUBLIC_MICROIN_URL=${NEXT_PUBLIC_MICROIN_URL}
WORKDIR /app
COPY package.json package-lock.json ./
# Evita problemas con seccomp/clone3 en hosts antiguos usando Alpine (musl)
RUN npm install --no-audit --no-fund

FROM deps AS builder
ARG NEXT_PUBLIC_MICROIN_URL
ENV NEXT_PUBLIC_MICROIN_URL=${NEXT_PUBLIC_MICROIN_URL}
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
ARG NEXT_PUBLIC_MICROIN_URL
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_MICROIN_URL=${NEXT_PUBLIC_MICROIN_URL}
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p .next/cache && chown -R node:node .next
EXPOSE 3000
USER node
CMD ["node", "server.js"]
