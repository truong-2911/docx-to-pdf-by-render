# ---- builder
FROM node:20-bookworm AS builder
WORKDIR /app

# Cài deps
COPY package*.json ./
RUN npm ci

# Copy code
COPY . .

# Build Next.js
RUN npm run build

# ---- runner
FROM node:20-bookworm AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Cài LibreOffice + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Copy build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/.next/server ./.next/server  
COPY --from=builder /app/public ./public

# Cổng chạy
EXPOSE 3000

# Chạy server Next.js
CMD ["sh","-lc","node server.js"]
