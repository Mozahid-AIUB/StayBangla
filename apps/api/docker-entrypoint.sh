#!/bin/sh
# Runs migrations, then the API.
#
# This exists because the start command was `sh -c "npx prisma migrate deploy
# && node dist/main.js"` and the container exited 127 — command not found —
# without saying which command. A one-line start command has nowhere to put
# that answer.
#
# Render's free tier has no pre-deploy step, so migrations have to run here.
set -e

echo "[start] node $(node --version), cwd $(pwd)"

# Say which required variables are missing, by name, before anything tries to
# use them.
#
# Without this the first failure was Prisma's: "Environment variable not found:
# DATABASE_URL", pointing at schema.prisma line 8 — accurate, but it looks like
# a schema problem rather than a deployment one, and it stops at the first
# missing variable instead of listing all of them. A deploy that is missing
# four values should say so once, not four times across four attempts.
#
# Values are never printed. Only whether each name is set.
missing=""
for required in \
  DATABASE_URL REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET OTP_PEPPER \
  SSLCOMMERZ_STORE_ID SSLCOMMERZ_STORE_PASSWORD MINIO_ACCESS_KEY MINIO_SECRET_KEY
do
  eval "value=\${$required:-}"
  if [ -z "$value" ]; then
    missing="$missing $required"
  fi
done

if [ -n "$missing" ]; then
  echo "[start] MISSING environment variables:$missing"
  echo "[start] set them in Render → the service → Environment, then redeploy."
  exit 1
fi
echo "[start] all required environment variables are set"

# Where the Prisma CLI can be, in order of likelihood. pnpm links workspace
# binaries into the package's own node_modules/.bin; the root .bin exists when
# a dependency was hoisted; and npx is the fallback that resolves either.
for candidate in \
  "./node_modules/.bin/prisma" \
  "../../node_modules/.bin/prisma" \
  "/repo/node_modules/.bin/prisma"
do
  if [ -x "$candidate" ]; then
    PRISMA="$candidate"
    break
  fi
done

if [ -z "$PRISMA" ]; then
  # Not fatal on its own — npx can still find it — but worth saying out loud,
  # because "migrations did not run" is otherwise invisible until a query
  # fails against a table that does not exist.
  echo "[start] prisma binary not found in node_modules; falling back to npx"
  PRISMA="npx --no-install prisma"
fi

echo "[start] migrating with: $PRISMA"
$PRISMA migrate deploy

echo "[start] listening"
# exec, so node becomes PID 1 and receives the platform's SIGTERM directly.
# Without it the shell holds PID 1, swallows the signal, and the container is
# killed after the grace period instead of shutting down cleanly — which on
# this API means dropping in-flight requests and leaving Prisma's pool open.
exec node dist/main.js
