FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
    unzip \
    libaio1 \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/oracle

RUN wget -q https://download.oracle.com/otn_software/linux/instantclient/2390000/instantclient-basic-linux.x64-23.9.0.25.07.zip \
    -O /tmp/instantclient.zip

RUN unzip -q /tmp/instantclient.zip -d /opt/oracle \
    && rm /tmp/instantclient.zip \
    && for d in /opt/oracle/instantclient_*; do ln -sfn "$d" /opt/oracle/instantclient; done \
    && echo "/opt/oracle/instantclient" > /etc/ld.so.conf.d/oracle-instantclient.conf \
    && ldconfig

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV ORACLE_CLIENT_LIB_DIR=/opt/oracle/instantclient
EXPOSE 9000

CMD ["npm", "start"]
