FROM ubuntu:22.04

RUN apt-get update && \
    apt-get install -y libreoffice curl unzip nodejs npm && \
    apt-get clean

WORKDIR /app

COPY . .

RUN npm install

CMD ["npm", "start"]
