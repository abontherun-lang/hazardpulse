#!/bin/sh

# Start Redis in the background (cache-only role — no persistence needed)
redis-server \
  --daemonize yes \
  --maxmemory 64mb \
  --maxmemory-policy allkeys-lru \
  --dir /data

# Wait for Redis to be ready
until redis-cli ping > /dev/null 2>&1; do
  sleep 0.5
done
echo "Redis ready"

# Start the Node app (foreground — Docker tracks this process)
cd /app/backend
exec node server.js
