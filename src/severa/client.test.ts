import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { getAccessToken } from "./token-manager";
import { severaFetch } from "./client";
import type { UserWithName } from "./types";

describe("Severa client (integration)", () => {
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
