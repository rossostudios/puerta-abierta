# syntax=docker/dockerfile:1.7
# Build with repo root as context:
#   docker build -f apps/web/Dockerfile .

FROM node:22-bookworm-slim AS deps

ENV NEXT_TELEMETRY_DISABLED=1 \
    npm_config_loglevel=warn

WORKDIR /repo/apps/web

COPY apps/web/package.json apps/web/package-lock.json ./
COPY packages/shared-api /repo/packages/shared-api

RUN npm ci --legacy-peer-deps

FROM node:22-bookworm-slim AS build

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_ADMIN_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_DOMAIN
ARG NEXT_PUBLIC_CLERK_JS_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL}" \
    NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL}" \
    NEXT_PUBLIC_ADMIN_URL="${NEXT_PUBLIC_ADMIN_URL}" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    NEXT_PUBLIC_CLERK_DOMAIN="${NEXT_PUBLIC_CLERK_DOMAIN}" \
    NEXT_PUBLIC_CLERK_JS_URL="${NEXT_PUBLIC_CLERK_JS_URL}"

WORKDIR /repo

COPY --from=deps /repo /repo
COPY apps/web /repo/apps/web
COPY packages/shared-api /repo/packages/shared-api

RUN cd /repo/apps/web && npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build /repo/apps/web/package.json /repo/apps/web/package-lock.json ./
COPY --from=build /repo/apps/web/.next ./.next
COPY --from=build /repo/apps/web/public ./public
COPY --from=build /repo/apps/web/next.config.mjs ./next.config.mjs
COPY --from=deps /repo/apps/web/node_modules ./node_modules

EXPOSE 3001

CMD ["npm", "run", "start"]
