# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Install with devDependencies; tsc and tsx live there.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Production dependencies only — this drops typescript and tsx, which is why
# the compiled dist/scripts/deploy-commands.js is used in-container rather than
# `npm run deploy-commands` (that script runs through tsx).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

# The state file and the log file are written at runtime. Created here, owned
# by the unprivileged user the container runs as, so a named volume inherits
# that ownership.
RUN mkdir -p /app/data /app/config /app/logs \
    && chown -R node:node /app/data /app/config /app/logs

USER node

# No EXPOSE: the bot only makes outbound connections to Discord's gateway.

CMD ["node", "dist/index.js"]
