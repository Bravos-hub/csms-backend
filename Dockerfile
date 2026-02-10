# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache python3 make g++ openssl

# Copy root configuration
COPY package*.json ./
COPY nest-cli.json ./
COPY tsconfig*.json ./

# Install all dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the apps
RUN npm run build api
RUN npm run build worker

# Stage 2: Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Prisma needs OpenSSL available at runtime for the query engine
RUN apk add --no-cache openssl

# Install only production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy built artifacts and prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

# The actual command to run will be overridden in docker-compose.yml for each service
CMD ["node", "dist/apps/api/main"]
