import { severaPaginate } from "./client";
import type { SeveraEnv } from "./client";
import type {
  CustomerModel,
  ProjectOutputModel,
  SalesStatusTypeOutputModel,
} from "./types";

const TTL_ACTIVE = 15 * 60;
const TTL_LONG = 24 * 60 * 60;

async function cached<T>(
  env: SeveraEnv,
  key: string,
  loader: () => Promise<T[]>,
  ttl = TTL_ACTIVE,
): Promise<T[]> {
  const hit = (await env.CACHE_KV.get(key, "json")) as T[] | null;
  if (hit) return hit;
  const fresh = await loader();
  await env.CACHE_KV.put(key, JSON.stringify(fresh), { expirationTtl: ttl });
  return fresh;
}

export function getActiveCustomers(env: SeveraEnv): Promise<CustomerModel[]> {
  return cached(env, "severa:ref:customers:active", () =>
    severaPaginate<CustomerModel>(env, "/v1/customers", {
      query: { isActive: true, rowCount: 500 },
    }),
  );
}

export function getActiveProjects(env: SeveraEnv): Promise<ProjectOutputModel[]> {
  return cached(env, "severa:ref:projects:active", () =>
    severaPaginate<ProjectOutputModel>(env, "/v1/projects", {
      query: { isClosed: false, rowCount: 500 },
    }),
  );
}

export function getSalesStatusTypesByState(
  env: SeveraEnv,
  state: "InProgress" | "Won" | "Lost",
): Promise<SalesStatusTypeOutputModel[]> {
  return cached(
    env,
    `severa:ref:salesstatustypes:${state.toLowerCase()}`,
    () =>
      severaPaginate<SalesStatusTypeOutputModel>(env, "/v1/salesstatustypes", {
        query: { active: true, salesState: state, rowCount: 100 },
      }),
    TTL_LONG,
  );
}

export function matches(haystack: string | number | undefined | null, needle: string): boolean {
  if (haystack === undefined || haystack === null) return false;
  return String(haystack).toLowerCase().includes(needle.toLowerCase());
}
