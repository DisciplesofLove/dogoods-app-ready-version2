#!/bin/bash
# Inject runtime environment variables into /usr/share/nginx/html/config.js
# This runs at container startup so secrets stay in Railway env vars, not in git.

CONFIG_FILE="/usr/share/nginx/html/config.js"

cat > "$CONFIG_FILE" <<EOCONFIG
window.__ENV__ = {
  VITE_SUPABASE_URL: "${VITE_SUPABASE_URL:-}",
  VITE_SUPABASE_ANON_KEY: "${VITE_SUPABASE_ANON_KEY:-}",
  VITE_BACKEND_URL: "${VITE_BACKEND_URL:-}",
  VITE_MAPBOX_TOKEN: "${VITE_MAPBOX_TOKEN:-}",
  DEEPSEEK_API_KEY: "${DEEPSEEK_API_KEY:-}",
  OPENAI_API_KEY: "${OPENAI_API_KEY:-}",
  API_TIMEOUT: "30000",
  API_MAX_RETRIES: "3",
  RATE_LIMIT_MAX_REQUESTS: "50",
  RATE_LIMIT_PREMIUM_MAX_REQUESTS: "100",
  RATE_LIMIT_TIME_WINDOW: "60000",
  ENABLE_MOCK_RESPONSES: "false",
  DEBUG_MODE: "false"
};
EOCONFIG

echo "Injected runtime config into $CONFIG_FILE"
