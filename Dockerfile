# ---- Build image
FROM node:20-bookworm AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- Runtime image
FROM node:20-bookworm
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# LibreOffice + fonts (để PDF hiển thị VN/CJK tốt)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice \
      fonts-dejavu \
      fonts-liberation \
      fonts-noto \
      fonts-noto-cjk \
      fonts-noto-color-emoji && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build Next (nếu bạn muốn build trong Docker)
RUN npm run build

EXPOSE 3000
# BẮT BUỘC: lắng nghe $PORT Render cấp
CMD ["sh", "-lc", "next start -p ${PORT:-3000}"]
