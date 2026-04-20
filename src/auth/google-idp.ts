import type {
  OAuthHelpers,
  AuthRequest,
} from "@cloudflare/workers-oauth-provider";
import type { SessionProps } from "./session";

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";
const OAUTH_REQ_COOKIE = "severa_mcp_oauth_req";

export interface GoogleEnv {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GOOGLE_HOSTED_DOMAIN: string;
  OAUTH_PROVIDER: OAuthHelpers;
}

export async function handleOAuthRequest(request: Request, env: GoogleEnv): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/authorize") return startAuthorize(request, env);
  if (url.pathname === "/callback") return handleCallback(request, env);
  if (url.pathname === "/" || url.pathname === "/healthz") {
    return new Response("severa-mcp OK", { headers: { "content-type": "text/plain" } });
  }
  return new Response("Not Found", { status: 404 });
}

async function startAuthorize(request: Request, env: GoogleEnv): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const redirectUri = new URL("/callback", request.url).toString();

  const state = crypto.randomUUID();
  const googleUrl = new URL(GOOGLE_AUTHORIZE);
  googleUrl.searchParams.set("client_id", env.GOOGLE_OAUTH_CLIENT_ID);
  googleUrl.searchParams.set("redirect_uri", redirectUri);
  googleUrl.searchParams.set("response_type", "code");
  googleUrl.searchParams.set("scope", "openid email profile");
  googleUrl.searchParams.set("access_type", "online");
  googleUrl.searchParams.set("prompt", "select_account");
  googleUrl.searchParams.set("hd", env.GOOGLE_HOSTED_DOMAIN);
  googleUrl.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: googleUrl.toString(),
      "set-cookie": cookie(OAUTH_REQ_COOKIE, btoa(JSON.stringify({ state, oauthReq }))),
    },
  });
}

async function handleCallback(request: Request, env: GoogleEnv): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return new Response("Missing code/state", { status: 400 });

  const stored = readCookie(request, OAUTH_REQ_COOKIE);
  if (!stored) return new Response("OAuth state missing; please retry.", { status: 400 });
  let parsed: { state: string; oauthReq: AuthRequest };
  try {
    parsed = JSON.parse(atob(stored));
  } catch {
    return new Response("OAuth state corrupted.", { status: 400 });
  }
  if (parsed.state !== state) return new Response("State mismatch.", { status: 400 });

  const redirectUri = new URL("/callback", request.url).toString();
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return new Response(`Google token exchange failed: ${await tokenRes.text()}`, { status: 502 });
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const uiRes = await fetch(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${access_token}` },
  });
  if (!uiRes.ok) return new Response("userinfo failed", { status: 502 });
  const info = (await uiRes.json()) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    hd?: string;
    name?: string;
  };

  if (
    !info.email ||
    !info.email_verified ||
    info.hd !== env.GOOGLE_HOSTED_DOMAIN ||
    !info.email.toLowerCase().endsWith(`@${env.GOOGLE_HOSTED_DOMAIN.toLowerCase()}`)
  ) {
    return new Response(
      `Access restricted to @${env.GOOGLE_HOSTED_DOMAIN} accounts (got: ${info.email ?? "none"}).`,
      { status: 403 },
    );
  }

  const props: SessionProps = {
    email: info.email.toLowerCase(),
    name: info.name ?? info.email,
    googleSub: info.sub,
  };

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: parsed.oauthReq,
    userId: info.sub,
    metadata: { email: props.email, name: props.name },
    scope: parsed.oauthReq.scope,
    props,
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: redirectTo,
      "set-cookie": clearCookie(OAUTH_REQ_COOKIE),
    },
  });
}

function cookie(name: string, value: string): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}
