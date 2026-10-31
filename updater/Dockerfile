# The TasksPipes updater (see docs/HOSTING.md, "One-click updates"): Node and the Docker CLI with Compose, nothing else.
FROM node:26-alpine
RUN apk add --no-cache docker-cli docker-cli-compose
WORKDIR /updater
COPY updater.mjs main.mjs ./
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
# Root: it talks to the Docker socket, which is why it is a separate service that takes nothing but a version number.
CMD ["node", "main.mjs"]
