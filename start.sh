#!/bin/bash
set -e

echo "=== DoGoods Full-Stack Startup ==="
echo "PORT=${PORT:-8080}"

# 1. Inject runtime env vars into config.js (Supabase keys, etc.)
/app/inject-config.sh

# 2. Generate nginx config from template (substitutes $PORT)
export PORT="${PORT:-8080}"
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# 3. Start FastAPI backend in background
echo "Starting FastAPI backend on :8000..."
cd /app
python -m uvicorn backend.app:app \
  --host 127.0.0.1 \
  --port 8000 \
  --log-level info &

BACKEND_PID=$!

# 4. Start nginx in foreground
echo "Starting nginx on :${PORT}..."
nginx -g "daemon off;" &
NGINX_PID=$!

# Wait for either process to exit
wait -n $BACKEND_PID $NGINX_PID
EXIT_CODE=$?

echo "Process exited with code $EXIT_CODE — shutting down..."
kill $BACKEND_PID $NGINX_PID 2>/dev/null || true
exit $EXIT_CODE
