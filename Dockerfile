# Stage 1: Build native dependencies
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Clean runtime environment
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node . .
COPY --chown=node:node --from=builder /app/node_modules ./node_modules

# Ensure data directory exists and is owned by node
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 8080
CMD ["npm", "start"]

