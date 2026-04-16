#!/bin/bash
export PORT="${PORT:-8080}"
echo "=== DoGoods startup: PORT=$PORT ==="

# 1. Inject Supabase/API keys into runtime config.js
/app/inject-config.sh

# 2. Substitute $PORT into nginx config
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf

# 3. Validate nginx config
nginx -t || { echo "nginx config error — check nginx.conf"; exit 1; }

# 4. Launch both nginx and uvicorn via supervisord
exec supervisord -c /etc/supervisor/conf.d/dogoods.conf
