// Live integration test — hits the real Severa API using credentials from
// .dev.vars. Not part of the default `npm test` run (excluded in
// vitest.config.ts). Opt in via `npm run test:integration`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { getAccessToken } from "../../src/severa/token-manager";
import { severaFetch } from "../../src/severa/client";
import type { Env } from "../../src/env";
import type { UserWithName } from "../../src/severa/types";

function loadDevVars(): Record<string, string> {
  try {
    const text = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    return Object.fromEntries(
      text
        .split("\n")
        .filter((l) => l.includes("="))
        .map((l) => {
          const eq = l.indexOf("=");
          const raw = l.slice(eq + 1).trim();
          const unquoted =
            (raw.startsWith('"') && raw.endsWith('"')) ||
            (raw.startsWith("'") && raw.endsWith("'"))
              ? raw.slice(1, -1)
              : raw;
          return [l.slice(0, eq).trim(), unquoted];
        }),
    );
  } catch {
    return {};
  }
}

function makeMemoryKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const v = store.get(key);
      if (!v) return null;
      return type === "json" ? JSON.parse(v) : v;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

const vars = loadDevVars();
const env = {
  CACHE_KV: makeMemoryKV(),
  OAUTH_KV: makeMemoryKV(),
  SEVERA_CLIENT_ID: vars.SEVERA_CLIENT_ID ?? "",
  SEVERA_CLIENT_SECRET: vars.SEVERA_CLIENT_SECRET ?? "",
  SEVERA_ENV: (vars.SEVERA_ENV ?? "prod") as "stag" | "prod",
  SEVERA_API_BASE_STAG:
    vars.SEVERA_API_BASE_STAG ?? "https://api.severa.stag.visma.com/rest-api",
  SEVERA_API_BASE_PROD:
    vars.SEVERA_API_BASE_PROD ?? "https://api.severa.visma.com/rest-api",
  ENABLE_WRITE_TOOLS: "false",
} as unknown as Env;

describe.skipIf(!vars.SEVERA_CLIENT_ID)("Severa client (live integration)", () => {
  it("obtains an access token via client credentials", async () => {
    const token = await getAccessToken(env);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("fetches at least one user from /v1/users", async () => {
    const users = await severaFetch<UserWithName[]>(env, "/v1/users", {
      query: { rowCount: 1 },
    });
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
    expect(users[0]).toHaveProperty("guid");
  });
});
