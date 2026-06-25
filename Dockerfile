# Atriveo JD Extractor — server-only image
# The frontend is served at application.atriveo.com (no build needed here)
FROM node:22-alpine AS builder
WORKDIR /build

COPY package.json ./
COPY server/ ./server/
COPY tsconfig.json ./

RUN npm install --ignore-scripts
RUN npx tsc -p server/tsconfig.json

# ── Production image ──────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

COPY --from=builder /build/server/dist ./server/dist
COPY package.json ./
COPY migrations/ ./migrations/

RUN npm install --omit=dev --ignore-scripts

EXPOSE 3001
ENV NODE_ENV=production
ENV DB_TYPE=sqlite
ENV SQLITE_PATH=/data/atriveo.db

VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "server/dist/index.js"]
