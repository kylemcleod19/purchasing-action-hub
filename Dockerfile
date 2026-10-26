# Single service: Express serves the API and the built React client. SQLite lives on a volume
# mounted at runtime (DATABASE_PATH), so migrations and seeding happen at startup, not build time.

FROM node:24.14.0-bookworm-slim AS build
WORKDIR /app
# Toolchain in case better-sqlite3 has to compile from source instead of using a prebuilt binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
# dist/server includes the SQL migrations (copied by the build script); dist/client is the SPA.
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["npm", "start"]
