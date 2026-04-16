# ===========================================================================
# DoGoods Full-Stack Dockerfile
# Stage 1: Build React frontend with Vite
# Stage 2: Run nginx (frontend) + uvicorn (FastAPI backend) together
# ===========================================================================

# --- Stage 1: Build frontend ---
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Accept Supabase vars as build args so Vite bakes them in
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_BACKEND_URL=""
ARG VITE_MAPBOX_TOKEN=""
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN

RUN npm run build

# --- Stage 2: Production runtime ---
FROM python:3.12-slim

# Install nginx and supervisor
RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx gettext-base && \
    rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Copy built frontend
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy backend source
COPY backend/ /app/backend/

# Copy nginx template and startup script
COPY nginx.prod.conf /etc/nginx/nginx.conf.template
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# Copy the runtime config injector script
COPY inject-config.sh /app/inject-config.sh
RUN chmod +x /app/inject-config.sh

WORKDIR /app

# Railway sets PORT dynamically (default 8080 if unset)
ENV PORT=8080
EXPOSE $PORT

CMD ["/app/start.sh"]