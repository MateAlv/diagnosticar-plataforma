# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS deps
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_MICROIN_URL
ARG NEXT_PUBLIC_HPO_API_URL
ARG NEXT_PUBLIC_GENPHENAI_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_MICROIN_URL=${NEXT_PUBLIC_MICROIN_URL}
ENV NEXT_PUBLIC_HPO_API_URL=${NEXT_PUBLIC_HPO_API_URL}
ENV NEXT_PUBLIC_GENPHENAI_URL=${NEXT_PUBLIC_GENPHENAI_URL}
WORKDIR /app
COPY package.json package-lock.json ./
# Evita problemas con seccomp/clone3 en hosts antiguos usando Alpine (musl)
RUN npm install --no-audit --no-fund

FROM deps AS builder
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_MICROIN_URL
ARG NEXT_PUBLIC_HPO_API_URL
ARG NEXT_PUBLIC_GENPHENAI_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_MICROIN_URL=${NEXT_PUBLIC_MICROIN_URL}
ENV NEXT_PUBLIC_HPO_API_URL=${NEXT_PUBLIC_HPO_API_URL}
ENV NEXT_PUBLIC_GENPHENAI_URL=${NEXT_PUBLIC_GENPHENAI_URL}
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
# The base image lags Alpine's security updates; without this the image ships
# known-vulnerable openssl and the CI scan fails.
RUN apk upgrade --no-cache
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_MICROIN_URL
ARG NEXT_PUBLIC_HPO_API_URL
ARG NEXT_PUBLIC_GENPHENAI_URL
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_MICROIN_URL=${NEXT_PUBLIC_MICROIN_URL}
ENV NEXT_PUBLIC_HPO_API_URL=${NEXT_PUBLIC_HPO_API_URL}
ENV NEXT_PUBLIC_GENPHENAI_URL=${NEXT_PUBLIC_GENPHENAI_URL}
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# The standalone server runs on node alone; npm is only build tooling and its
# bundled dependencies are the entire image CVE surface.
RUN mkdir -p .next/cache && chown -R node:node .next \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
EXPOSE 3000
USER node
# Force bind on all interfaces so Traefik can reach the app through Docker networks.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 node server.js"]
