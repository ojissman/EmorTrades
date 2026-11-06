FROM node:22-slim

# The connector manages sibling gateway containers through the host's Docker
# daemon (mount /var/run/docker.sock in docker-compose.yml). It creates the
# trading kill-switch file and never calls any trading endpoint itself.
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY src/ ./src/
RUN mkdir -p /kill-switch

# Run as root: docker.sock access + writing the kill-switch bind mount.
CMD ["node", "src/main.mjs"]
