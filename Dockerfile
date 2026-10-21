# apaleo-datev-export container image. Built locally only: there is no
# registry image. See docs/docker.md.
#
#   docker build -t apaleo-datev-export:local .
#   docker run --rm --env-file .env -v "$PWD/config:/config:ro" -v "$PWD/data:/data" apaleo-datev-export:local

# --- build: compile TypeScript, then keep only the runtime dependencies ------
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# --- runtime ------------------------------------------------------------------
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    APALEO_DATEV_CONFIG=/config/apaleo-datev.config.yaml \
    APALEO_DATEV_OUTPUT_DIR=/data
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY templates ./templates
COPY examples/demo ./examples/demo
COPY LICENSE DISCLAIMER.md README.md ./
RUN mkdir -p /config /data && chown node:node /data
# The config and mapping files live in /config (mounted read-only), and the
# tool resolves the mapping paths in the config against the working directory.
WORKDIR /config
USER node
VOLUME ["/config", "/data"]
ENTRYPOINT ["node", "/app/dist/cli/main.js"]
CMD ["schedule", "--once"]
