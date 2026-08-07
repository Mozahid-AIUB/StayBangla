# Two stages: one that can build, one that only runs.
#
# The build stage carries pnpm, the whole workspace, devDependencies and the
# TypeScript compiler — several hundred megabytes that have no business being
# on a running server. Every one of them is code an attacker could reach if
# they got in, and every one of them is bytes Cloud Run pulls on a cold start,
# which is time the first visitor waits.
#
# ---- build ------------------------------------------------------------------
FROM node:22-slim AS build

# openssl is Prisma's, not ours: the query engine links against it, and without
# it `prisma generate` produces a client that fails at runtime rather than at
# build time — the worst place to find out.
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
RUN corepack enable

# Manifests before source. Docker caches each layer by its inputs, so a change
# to a .ts file must not invalidate the install — that is the difference
# between a ten-second rebuild and a three-minute one.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/config/package.json ./packages/config/

# --frozen-lockfile, so a lockfile that drifted from package.json fails the
# build here rather than silently installing different versions than the ones
# that were tested.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# Explicit, because --ignore-scripts above skipped the postinstall that
# normally does this. A missing client is a runtime error, so it is worth the
# extra line to be sure it ran.
RUN pnpm --filter @staybangla/api exec prisma generate
RUN pnpm --filter @staybangla/api build

# Generate the client while the CLI is still here, then reinstall
# production-only. `pnpm prune` does not reliably strip a workspace's
# devDependencies through symlinks, so the tree is rebuilt from the lockfile —
# the same versions, minus everything only the build needed.
#
# Order matters and was wrong: `prisma` is a devDependency, so a `--prod`
# install removes it, and running `prisma generate` afterwards asks for a
# binary that was deleted a moment earlier. Generating first leaves the output
# in @prisma/client, which is a real dependency and survives.
RUN pnpm --filter @staybangla/api exec prisma generate \
    && pnpm install --frozen-lockfile --prod --ignore-scripts

# The Prisma CLI now lives in `dependencies`, not `devDependencies`, so the
# production install above keeps it.
#
# That is a real change of meaning rather than a workaround: Render's free tier
# has no pre-deploy step, so `prisma migrate deploy` runs from the container's
# start command — the CLI is part of what the API needs to run, not only to be
# built.
#
# The first attempt installed it separately with npm, which failed: npm cannot
# read a node_modules tree pnpm laid out, and reported it as
# "Cannot read properties of null".

# ---- run --------------------------------------------------------------------
FROM node:22-slim AS run

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
ENV NODE_ENV=production

# node, not root. The base image ships this user; a container that never needs
# to write outside its own tree has no reason to run as root, and if the
# process is ever compromised the blast radius is smaller for one line.
COPY --from=build --chown=node:node /repo/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=node:node /repo/packages ./packages
COPY --from=build --chown=node:node /repo/apps/api/package.json ./apps/api/

USER node

# Cloud Run assigns the port at runtime and the app must listen on it — a
# hardcoded port means the container starts, passes no health check, and is
# killed with nothing in the logs to explain it. 8080 is only the local
# default; PORT wins when it is set.
ENV PORT=8080
EXPOSE 8080

WORKDIR /repo/apps/api
CMD ["node", "dist/main.js"]
