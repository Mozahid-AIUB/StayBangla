/**
 * Which port to listen on.
 *
 * `PORT` first, because that is the one thing every container host agrees on:
 * Render, Cloud Run, Fly and Heroku all inject it and then health-check that
 * exact port. An app that listens somewhere else starts cleanly, answers
 * nothing, and is killed — with nothing in its own logs to say why, because
 * from inside the container everything went fine.
 *
 * `API_PORT` second, because that is what `.env` sets for local development and
 * what `env.validation.ts` documents.
 *
 * Values that are not usable ports are ignored rather than trusted. An empty
 * string is what an unset variable becomes once a shell or a dashboard has
 * passed it along, and `Number("")` is 0 — which binds to a random free port.
 * The container would then look healthy and be unreachable, which is the same
 * failure this function exists to prevent.
 */
export function resolveListenPort(
  env: Record<string, string | undefined>,
): number {
  return usablePort(env.PORT) ?? usablePort(env.API_PORT) ?? 3001;
}

function usablePort(value: string | undefined): number | null {
  if (!value || !value.trim()) return null;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}
