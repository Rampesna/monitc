FROM node:22.14-alpine AS marketing
WORKDIR /build/website
COPY website/package.json website/package-lock.json ./
RUN npm ci
COPY website/ ./
RUN npm run build

FROM node:22.14-alpine AS application
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
    && npm run build --workspace @monitc/web

FROM nginxinc/nginx-unprivileged:1.29-alpine
ARG VITE_API_URL=https://monitc-api.talhacan.com
COPY infra/docker/nginx-web.conf /tmp/default.conf
RUN api_origin="${VITE_API_URL%/}" \
    && ws_origin="$(printf '%s' "$api_origin" | sed -e 's|^https:|wss:|' -e 's|^http:|ws:|')" \
    && sed -e "s|__MONITC_API_ORIGIN__|$api_origin|g" \
           -e "s|__MONITC_WS_ORIGIN__|$ws_origin|g" \
           /tmp/default.conf > /etc/nginx/conf.d/default.conf \
    && rm /tmp/default.conf
COPY --from=marketing /build/website/dist /usr/share/nginx/html
COPY --from=application /build/platform/apps/web/dist /usr/share/nginx/html/app
EXPOSE 8080
