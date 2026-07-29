FROM node:22.14-bookworm-slim AS build
WORKDIR /build/platform

COPY platform/package.json platform/package-lock.json ./
COPY platform/apps/api/package.json apps/api/package.json
COPY platform/apps/web/package.json apps/web/package.json
COPY platform/apps/admin/package.json apps/admin/package.json
COPY platform/packages/shared/package.json packages/shared/package.json
RUN npm ci

COPY platform/ ./
RUN npm run build --workspace @monitc/shared \
    && npm run build --workspace @monitc/api \
    && npm prune --omit=dev

FROM node:22.14-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 10001 monitc \
    && useradd --system --uid 10001 --gid monitc --home-dir /app monitc
COPY --from=build --chown=monitc:monitc /build/platform /app
USER 10001
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
