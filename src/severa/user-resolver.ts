import { severaPaginate } from "./client";
import type { SeveraEnv } from "./client";
import type { Guid, UserWithName } from "./types";

const CACHE_TTL_SECONDS = 24 * 60 * 60;

function resolveEmail(env: SeveraEnv, email: string): string {
  if (!env.SEVERA_EMAIL_MAP) return email;
  try {
    const map = JSON.parse(env.SEVERA_EMAIL_MAP) as Record<string, string>;
    return map[email.toLowerCase()] ?? email;
  } catch {
    return email;
  }
}

export async function resolveSeveraUserGuid(
  env: SeveraEnv,
  email: string,
): Promise<Guid | null> {
  const severaEmail = resolveEmail(env, email);
  const key = cacheKey(email);
  const cached = await env.CACHE_KV.get(key);
  if (cached) return cached;

  const users = await severaPaginate<UserWithName>(env, "/v1/users", {
    query: { email: severaEmail, rowCount: 25 },
  });
  const match = users.find((u) => u.email?.toLowerCase() === severaEmail.toLowerCase());
  if (!match) return null;

  await env.CACHE_KV.put(key, match.guid, { expirationTtl: CACHE_TTL_SECONDS });
  return match.guid;
}

export async function requireSeveraUserGuid(env: SeveraEnv, email: string): Promise<Guid> {
  const guid = await resolveSeveraUserGuid(env, email);
  if (!guid) {
    throw new Error(
      `No Severa user found for email ${email}. Ask an admin to add you to Severa or confirm the email on your user record.`,
    );
  }
  return guid;
}

function cacheKey(email: string): string {
  return `severa:user:${email.trim().toLowerCase()}`;
}
