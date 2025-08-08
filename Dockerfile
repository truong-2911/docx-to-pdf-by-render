FROM node:20-bullseye

# Cài LibreOffice và các gói phụ thuộc
RUN apt-get update && \
    apt-get install -y libreoffice curl unzip && \
    apt-get clean

WORKDIR /app

COPY . .

RUN npm install

CMD ["node", "server.js"]
