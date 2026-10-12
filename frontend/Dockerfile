FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY angular.json tsconfig*.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build -- --base-href /vox/

FROM nginx:stable-alpine
COPY deploy/nginx-container.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/vox-ui/browser/ /usr/share/nginx/html/vox/
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/vox/index.html || exit 1
