# syntax=docker/dockerfile:1.7

# The NEXT_PUBLIC_* args belong to the builder stage, not here.
#
# npm does not read them — only `next build` bakes them into the client bundle
# — but an ENV layer above `npm install` means every distinct combination of
# them invalidates the install beneath it. Production, staging and each local
# variant then wrote their own ~800 MB dependency layer, which is how this
# filled ~9.5 GB of one laptop's disk.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` rather than `npm install`: it installs exactly what the lockfile
# pins instead of re-resolving, so an image cannot quietly get a different
# dependency tree from the one that was tested.
#
# The cache mount is shared between builds rather than baked into a layer, so
# a rebuild reuses the download without paying for it in image size.
# Requires the syntax directive above.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund

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
