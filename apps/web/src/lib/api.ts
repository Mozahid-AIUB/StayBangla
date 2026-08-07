/**
 * The only way this app talks to the API.
 *
 * Everything goes through here so three things are decided once instead of at
 * every call site: where the API is, that its paths carry a version prefix, and
 * what happens when a token expires.
 */

/**
 * Where the API lives, as a committed default rather than a deployment setting.
 *
 * The same shape as `NEXT_PUBLIC_MEDIA_BASE_URL`, and for the same reason. That
 * one was never set anywhere, so the base resolved to the empty string, the
 * browser asked the site for `/videos/hero-1-720.mp4`, all four renditions
 * 404'd, and the hero fell back to its still image — which looks deliberate.
 * Nobody noticed for a day.
 *
 * A dashboard build variable is absent from `pnpm build` on a laptop, absent
 * from CI, and invisible to anyone reading this repository. An API origin is
 * not a credential.
 *
 * TODO: replace the localhost fallback once the API is deployed. Until then a
 * production build points at a machine that is not there, which fails loudly
 * rather than silently — the right way round.
 */
const API_ORIGIN = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

/**
 * Every endpoint the browser touches is under `/v1`.
 *
 * `configure-app.ts` enables URI versioning with `defaultVersion: "1"`. Only
 * three controllers opt out — `/health`, `/payments/sslcommerz/ipn` and
 * `/internal/bookings/sweep` — and none of them is called from a page, so this
 * needs no escape hatch. A path written by hand somewhere in a component would
 * 404, and a 404 from a list endpoint reads as "no data" rather than "wrong
 * URL".
 */
const VERSION_PREFIX = "/v1";

/** Where the session lives between reloads. `output: "export"` means there is
 * no server to hold one. */
const TOKEN_KEY = "staybangla.accessToken";
const USER_KEY = "staybangla.user";

/**
 * A failed request, with enough detail for a page to say something useful.
 *
 * An empty result and a failed request look identical if both render as an
 * empty list, and only one of them is something the visitor should be told
 * about.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** The request never reached the API — offline, DNS, CORS, or nothing
   * listening. Distinct from a 4xx, which means the API answered. */
  get isNetworkFailure(): boolean {
    return this.status === 0;
  }

  /** The session is gone and refreshing did not help. Pages that need a
   * signed-in visitor use this to send them to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export interface SessionUser {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  roles: string[];
}

/** Reads a value the browser stored. Returns null during a static build and in
 * any browser with storage disabled — a private window, mostly — rather than
 * throwing, so the page renders signed-out instead of not at all. */
function readStored(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage disabled; the session lasts this page only */
  }
}

export function getAccessToken(): string | null {
  return readStored(TOKEN_KEY);
}

export function getCurrentUser(): SessionUser | null {
  const raw = readStored(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    // Corrupt or from an older shape. Drop it rather than crashing every page
    // that asks who is signed in.
    writeStored(USER_KEY, null);
    return null;
  }
}

export function setSession(token: string, user: SessionUser | null): void {
  writeStored(TOKEN_KEY, token);
  writeStored(USER_KEY, user ? JSON.stringify(user) : null);
  notifySessionChanged();
}

export function clearSession(): void {
  writeStored(TOKEN_KEY, null);
  writeStored(USER_KEY, null);
  notifySessionChanged();
}

/**
 * Lets the header re-render when the session changes.
 *
 * `localStorage` fires a `storage` event in *other* tabs but not the one that
 * made the change, so a custom event covers this tab and the built-in one
 * covers the rest — sign out in one tab and every tab agrees.
 */
const SESSION_EVENT = "staybangla:session";

function notifySessionChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function onSessionChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(SESSION_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SESSION_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Query parameters. Undefined, null and empty values are dropped, so a
   * caller can pass optional filters straight through. */
  query?: Record<string, string | number | undefined | null>;
  /** Set internally to stop a refresh loop. */
  skipRefresh?: boolean;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const normalised = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${API_ORIGIN}${VERSION_PREFIX}${normalised}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Nest's error shape is `{ statusCode, message, error }`, where `message` is a
 * string or an array of validation messages. Pull out something a person can
 * read; fall back to the status when there is nothing. */
function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message) && message.length > 0) return message.join(", ");
  }
  return `Request failed with status ${status}`;
}

/**
 * Exchanges the refresh cookie for a new access token.
 *
 * The refresh token is an httpOnly cookie the API set at sign-in, so this
 * carries no body — `credentials: "include"` is what sends it.
 */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return null;
    const body = (await parseBody(response)) as { accessToken?: string } | null;
    return body?.accessToken ?? null;
  } catch {
    return null;
  }
}

/**
 * One request to the API.
 *
 * On 401 it refreshes once, retries, and if the refresh also fails it clears
 * the session and throws an unauthenticated error. Once, not in a loop: a
 * refresh endpoint returning 401 forever would otherwise spin against a
 * rate-limited route and lock the visitor out of signing in again.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, query, skipRefresh = false } = options;

  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (cause) {
    // fetch only rejects when the request never completed. Status 0 marks that
    // apart from any answer the API gave.
    throw new ApiError(
      0,
      "Could not reach StayBangla. Check your connection and try again.",
      cause,
    );
  }

  if (response.status === 401 && !skipRefresh) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      setSession(refreshed, getCurrentUser());
      return apiRequest<T>(path, { ...options, skipRefresh: true });
    }
    clearSession();
    throw new ApiError(401, "Your session has ended. Please sign in again.");
  }

  const parsed = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(parsed, response.status),
      parsed,
    );
  }

  return parsed as T;
}
