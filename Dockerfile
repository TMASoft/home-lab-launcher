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
COPY . .
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8080
CMD ["npm", "start"]

