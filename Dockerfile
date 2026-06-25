# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /build
COPY package*.json ./
COPY app/ ./app/
COPY tsconfig.json ./
RUN npm install --ignore-scripts
RUN npm run build

# ── Stage 2: build the Express server ────────────────────────────────────────
FROM node:20-alpine AS server-builder
WORKDIR /build
COPY package*.json ./
COPY server/ ./server/
COPY tsconfig.json ./
RUN npm install --ignore-scripts
RUN npx tsc -p server/tsconfig.json

# ── Stage 3: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Copy built artifacts
COPY --from=frontend-builder /build/dist ./public
COPY --from=server-builder /build/server/dist ./server
COPY package*.json ./
COPY migrations/ ./migrations/

# Install production deps only
RUN npm install --omit=dev --ignore-scripts

# Serve static files from Express
RUN npm install serve-static --save

EXPOSE 3001
ENV NODE_ENV=production
ENV DB_TYPE=sqlite
ENV SQLITE_PATH=/data/atriveo.db

# Data volume for SQLite persistence
VOLUME ["/data"]

CMD ["node", "server/index.js"]
