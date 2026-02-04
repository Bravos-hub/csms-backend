# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for bcrypt and other native modules
RUN apk add --no-cache python3 make g++

# Copy workspace configuration
COPY package*.json ./
COPY nest-cli.json ./
COPY tsconfig*.json ./

# Copy app and package configurations
COPY apps/api/package*.json ./apps/api/
COPY apps/worker/package*.json ./apps/worker/
COPY packages/db/package*.json ./packages/db/
COPY packages/domain/package*.json ./packages/domain/
COPY packages/sdk/package*.json ./packages/sdk/

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

# Install only production dependencies
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY apps/worker/package*.json ./apps/worker/
COPY packages/db/package*.json ./packages/db/
COPY packages/domain/package*.json ./packages/domain/
COPY packages/sdk/package*.json ./packages/sdk/

RUN npm install --omit=dev

# Copy built artifacts and prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/prisma ./prisma

# The actual command to run will be overridden in app.yaml for each service
CMD ["node", "dist/apps/api/main"]
