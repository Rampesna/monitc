FROM node:22.22-alpine AS build
WORKDIR /build/platform
ARG VITE_API_URL=https://monitc-api.talhacan.com
ENV VITE_API_URL=$VITE_API_URL
COPY platform/package.json platform/package-lock.json ./
COPY platform/apps/api/package.json apps/api/package.json
COPY platform/apps/web/package.json apps/web/package.json
COPY platform/apps/admin/package.json apps/admin/package.json
COPY platform/packages/shared/package.json packages/shared/package.json
RUN npm ci --ignore-scripts
COPY platform/ ./
RUN npm run build --workspace @monitc/shared \
    && npm run build --workspace @monitc/admin

FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG VITE_API_URL=https://monitc-api.talhacan.com
COPY --chown=101:101 infra/docker/nginx-admin.conf /tmp/default.conf
RUN api_origin="${VITE_API_URL%/}" \
    && sed "s|__MONITC_API_ORIGIN__|$api_origin|g" \
           /tmp/default.conf > /etc/nginx/conf.d/default.conf \
    && rm /tmp/default.conf
COPY --from=build /build/platform/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
