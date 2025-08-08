FROM node:18-bullseye

# Cài LibreOffice và các tiện ích
RUN apt-get update && \
    apt-get install -y libreoffice curl unzip && \
    apt-get clean

# App code
WORKDIR /app

COPY . .

RUN npm install

CMD ["node", "server.js"]
