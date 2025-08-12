 # ---- builder
 FROM node:20-bookworm AS builder
 WORKDIR /app
 COPY package*.json ./
 RUN npm ci
 COPY . .
 # build standalone (không export)
 RUN npm run build
 
 # ---- runner
 FROM node:20-bookworm AS runner
 ENV NODE_ENV=production
 ENV NEXT_TELEMETRY_DISABLED=1
 ENV PORT=3000
 WORKDIR /app
 
 # LibreOffice + fonts (đủ cho convert)
 RUN apt-get update && apt-get install -y --no-install-recommends \
     libreoffice-writer \
     fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
   && rm -rf /var/lib/apt/lists/*
 
 COPY --from=builder /app/.next/standalone ./.next/standalone
 COPY --from=builder /app/.next/static ./.next/static
 COPY --from=builder /app/public ./public
 COPY server.cjs ./server.cjs
 COPY lib/keep-alive.cjs ./lib/keep-alive.cjs
 
 EXPOSE 3000
 CMD ["node","server.cjs"]
