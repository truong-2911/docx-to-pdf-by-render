# -------- builder --------
  FROM node:20-bookworm AS builder
  WORKDIR /app
  
  # Cài deps (cả devDeps để build)
  COPY package*.json ./
  RUN npm ci
  
  # Copy source và build
  COPY . .
  RUN npm run build
  
  # -------- runner --------
  FROM node:20-bookworm AS runner
  ENV NODE_ENV=production
  ENV NEXT_TELEMETRY_DISABLED=1
  WORKDIR /app
  
  # LibreOffice + fonts (đủ để writer xuất PDF)
  RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice-writer \
      fonts-dejavu fonts-liberation fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
  
  # ⬇️ Quan trọng: copy đủ artefacts của Next
  # - standalone: server.js + node_modules cần thiết
  # - static: assets tĩnh
  # - server: middleware, API routes, manifests
  COPY --from=builder /app/.next/standalone ./           
  COPY --from=builder /app/.next/static ./.next/static  
  COPY --from=builder /app/.next/server ./.next/server  
  COPY --from=builder /app/public ./public             
  
  # (Tuỳ chọn, an toàn hơn nếu bạn có code đọc file runtime)
  # COPY --from=builder /app/app ./app
  # COPY --from=builder /app/lib ./lib
  
  # Render tự đặt $PORT; mặc định Next standalone lắng nghe PORT nếu có
  EXPOSE 3000
  CMD ["node", "server.js"]
  