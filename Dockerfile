# ---- builder
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Build Next.js ở chế độ standalone
RUN npm run build

# ---- runner
FROM node:20-bookworm AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DEBIAN_FRONTEND=noninteractive \
    HOME=/tmp
WORKDIR /app

# LibreOffice + fonts (đủ để convert + hiển thị font phổ biến)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Copy artefacts của Next (standalone)
# Lưu ý: copy cả thư mục standalone vào root để có /app/server.js
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
# Chạy server standalone của Next
CMD ["node", "server.js"]
