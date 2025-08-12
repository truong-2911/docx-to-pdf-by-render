# ---- builder: cài full deps & build
FROM node:20-bookworm AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci                          # ⬅️ CÀI CẢ devDeps

COPY . .
RUN npm run build

# ---- runner: prod deps + LibreOffice
FROM node:20-bookworm AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# LibreOffice + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice fonts-dejavu fonts-liberation fonts-noto fonts-noto-cjk fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# prod deps
COPY package*.json ./
RUN npm ci --omit=dev               # ⬅️ chỉ prod deps cho runtime

# copy build artefacts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/app ./app
COPY --from=builder /app/lib ./lib

EXPOSE 3000
CMD ["sh","-lc","next start -p ${PORT:-3000}"]
