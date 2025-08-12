# ---- builder
FROM node:20-bookworm AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build   # tạo .next/standalone

# ---- runner
FROM node:20-bookworm AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DEBIAN_FRONTEND=noninteractive
ENV HOME=/tmp
WORKDIR /app

# LibreOffice + fonts
RUN apt-get update && apt-get install -y -q --no-install-recommends \
    libreoffice-writer \
    fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Copy artefacts
COPY --from=builder /app/.next/standalone ./.next/standalone
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY server.cjs ./server.cjs
COPY lib/keep-alive.cjs ./lib/keep-alive.cjs

EXPOSE 3000
CMD ["node","server.cjs"] 
