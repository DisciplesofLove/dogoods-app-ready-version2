# ===========================================================================
# DoGoods Full-Stack Dockerfile
# Stage 1: Build React frontend with Vite
# Stage 2: Run nginx (frontend) + uvicorn (FastAPI backend) via supervisord
# ===========================================================================

# --- Stage 1: Build frontend ---
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Build args - optional, keys also injected at runtime via inject-config.sh
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_ANON_KEY=""
ARG VITE_BACKEND_URL=""
ARG VITE_MAPBOX_TOKEN=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

COPY . .
RUN npm run build

# --- Stage 2: Production runtime ---
FROM python:3.12-slim

# Install nginx, supervisord, and envsubst (gettext-base)
RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx supervisor gettext-base && \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/nginx/sites-enabled/default \
          /etc/nginx/sites-available/default \
          /etc/nginx/conf.d/default.conf

# Install Python backend dependencies
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy built frontend
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy backend source
COPY backend/ /app/backend/

# Copy deployment config files
COPY nginx.prod.conf /etc/nginx/nginx.conf.template
COPY supervisord.conf /etc/supervisor/conf.d/dogoods.conf
COPY start.sh /app/start.sh
COPY inject-config.sh /app/inject-config.sh
RUN chmod +x /app/start.sh /app/inject-config.sh

WORKDIR /app

# Railway provides $PORT at runtime; default 8080
ENV PORT=8080
EXPOSE 8080

CMD ["/app/start.sh"]