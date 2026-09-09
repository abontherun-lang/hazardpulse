FROM node:20-alpine

# Install Redis (response cache) and PostGIS tools (shp2pgsql for TIGER import)
RUN apk add --no-cache redis postgis

WORKDIR /app

# Install Node deps (cached layer)
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

# Copy source (.dockerignore keeps node_modules, tests and .env out)
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Startup script — launches Redis then Node
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

CMD ["/app/start.sh"]
