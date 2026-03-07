# syntax=docker/dockerfile:1.7
# Build with repo root as context:
#   docker build -f apps/admin/Dockerfile .

FROM node:22-bookworm-slim AS deps

WORKDIR /repo/apps/admin

COPY apps/admin/package.json apps/admin/package-lock.json ./
COPY packages/shared-api /repo/packages/shared-api
COPY packages/marketplace-shared /repo/packages/marketplace-shared

RUN npm ci --legacy-peer-deps

FROM node:22-bookworm-slim AS build

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_DOMAIN
ARG NEXT_PUBLIC_CLERK_JS_URL

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_API_BASE_URL="${NEXT_PUBLIC_API_BASE_URL}" \
    NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL}" \
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}" \
    NEXT_PUBLIC_CLERK_DOMAIN="${NEXT_PUBLIC_CLERK_DOMAIN}" \
    NEXT_PUBLIC_CLERK_JS_URL="${NEXT_PUBLIC_CLERK_JS_URL}"

WORKDIR /repo

COPY --from=deps /repo /repo
COPY apps/admin /repo/apps/admin
COPY packages/shared-api /repo/packages/shared-api
COPY packages/marketplace-shared /repo/packages/marketplace-shared

RUN cd /repo/apps/admin && npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

COPY --from=build /repo/apps/admin/.next/standalone ./
COPY --from=build /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /repo/apps/admin/public ./apps/admin/public

EXPOSE 3000

CMD ["node", "apps/admin/server.js"]
