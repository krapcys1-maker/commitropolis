# Commitverse mapping service: Node + git, no npm dependencies.
FROM node:22-alpine
RUN apk add --no-cache git && git config --system core.quotepath off
WORKDIR /app
COPY ingest ./ingest
COPY server/server.mjs ./server/server.mjs
ENV PORT=8787 DATA_DIR=/data/cities CACHE_DIR=/data/cache
RUN mkdir -p /data/cities /data/cache && chown -R node:node /data
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "server/server.mjs"]
