FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY packages/protocol/package.json packages/protocol/package.json
RUN npm install --workspace @linger/web --workspace @linger/protocol

FROM dependencies AS builder
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ARG NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws/voice
ARG NEXT_PUBLIC_VOICE_PROVIDER=mock
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_VOICE_PROVIDER=$NEXT_PUBLIC_VOICE_PROVIDER
COPY apps/web apps/web
COPY packages/protocol packages/protocol
RUN npm run build --workspace @linger/protocol && npm run build --workspace @linger/web

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
