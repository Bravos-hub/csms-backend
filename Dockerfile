FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the specific app (APP_NAME passed as build arg)
ARG APP_NAME=api
RUN npm run build ${APP_NAME}

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist/apps/${APP_NAME} ./dist
COPY --from=builder /app/prisma ./prisma

# Expose port (default 3000)
EXPOSE 3000

CMD ["node", "dist/main"]
