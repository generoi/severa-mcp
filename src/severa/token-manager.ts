import type { OAuthTokenResponse } from "./types";

const KV_KEY = "severa:token";
const EXPIRY_BUFFER_SECONDS = 300;
const TOKEN_PATH = "/v1/token";

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export interface TokenManagerEnv {
  CACHE_KV: KVNamespace;
  SEVERA_CLIENT_ID: string;
  SEVERA_CLIENT_SECRET: string;
  SEVERA_API_BASE_STAG: string;
  SEVERA_API_BASE_PROD: string;
  SEVERA_ENV: "stag" | "prod";
  ENABLE_WRITE_TOOLS?: string;
  SEVERA_EMAIL_MAP?: string;
}

export function severaBaseUrl(env: TokenManagerEnv): string {
  return env.SEVERA_ENV === "prod" ? env.SEVERA_API_BASE_PROD : env.SEVERA_API_BASE_STAG;
}

const READ_SCOPES = [
  "customers:read",
  "projects:read",
  "users:read",
  "hours:read",
  "invoices:read",
  "activities:read",
];

const WRITE_SCOPES = ["hours:write"];

export function requestedScopes(env: TokenManagerEnv): string {
  const writeEnabled = env.ENABLE_WRITE_TOOLS === "true";
  return [...READ_SCOPES, ...(writeEnabled ? WRITE_SCOPES : [])].join(" ");
}

let inFlight: Promise<string> | null = null;

export async function getAccessToken(env: TokenManagerEnv): Promise<string> {
  const cached = await readStored(env.CACHE_KV);
  if (cached && cached.expiresAt - EXPIRY_BUFFER_SECONDS > nowSeconds()) {
    return cached.accessToken;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const fresh = cached?.refreshToken
        ? await refreshToken(env, cached.refreshToken).catch(() => issueToken(env))
        : await issueToken(env);
      await writeStored(env.CACHE_KV, fresh);
      return fresh.accessToken;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

async function issueToken(env: TokenManagerEnv): Promise<StoredToken> {
  const res = await fetch(`${severaBaseUrl(env)}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_Id: env.SEVERA_CLIENT_ID,
      client_Secret: env.SEVERA_CLIENT_SECRET,
      scope: requestedScopes(env),
    }),
  });
  if (!res.ok) throw new Error(`Severa token request failed ${res.status}: ${await safeText(res)}`);
  const body = (await res.json()) as OAuthTokenResponse;
  return toStored(body);
}

async function refreshToken(env: TokenManagerEnv, refresh: string): Promise<StoredToken> {
  const res = await fetch(`${severaBaseUrl(env)}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_Id: env.SEVERA_CLIENT_ID,
      client_Secret: env.SEVERA_CLIENT_SECRET,
      refresh_token: refresh,
    }),
  });
  if (!res.ok) throw new Error(`Severa token refresh failed ${res.status}`);
  const body = (await res.json()) as OAuthTokenResponse;
  return toStored(body);
}

function toStored(body: OAuthTokenResponse): StoredToken {
  return {
    accessToken: body.access_token,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    expiresAt: nowSeconds() + body.access_token_expires_in,
  };
}

async function readStored(kv: KVNamespace): Promise<StoredToken | null> {
  return (await kv.get(KV_KEY, "json")) as StoredToken | null;
}

async function writeStored(kv: KVNamespace, token: StoredToken): Promise<void> {
  await kv.put(KV_KEY, JSON.stringify(token), {
    expirationTtl: Math.max(60, token.expiresAt - nowSeconds() + 60),
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "<no body>";
  }
}
