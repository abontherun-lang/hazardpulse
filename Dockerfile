FROM node:20-alpine

# PostGIS client tools (shp2pgsql + psql) for the TIGER/Line import
RUN apk add --no-cache postgis

WORKDIR /app

# Install Node deps (cached layer)
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

# Copy source (.dockerignore keeps node_modules, tests and .env out)
COPY backend/ ./backend/
COPY frontend/ ./frontend/

EXPOSE 3000

# 200 while Postgres answers, 503 otherwise (server.js /api/health).
# start-period covers the first-boot TIGER/Line download.
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

WORKDIR /app/backend
CMD ["node", "server.js"]
