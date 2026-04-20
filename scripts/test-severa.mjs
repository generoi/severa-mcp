#!/usr/bin/env node
// Quick smoke test for Severa API credentials from .dev.vars
// Usage: node scripts/test-severa.mjs

import { readFileSync } from "fs";
import { resolve } from "path";

const devVars = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
const vars = Object.fromEntries(
  devVars
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const eq = l.indexOf("=");
      return [l.slice(0, eq).trim(), l.slice(eq + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const base =
  (vars.SEVERA_ENV ?? "prod") === "prod"
    ? (vars.SEVERA_API_BASE_PROD ?? "https://api.severa.visma.com/rest-api")
    : (vars.SEVERA_API_BASE_STAG ?? "https://api.severa.stag.visma.com/rest-api");

console.log(`Base URL: ${base}`);
console.log(`Client ID: ${vars.SEVERA_CLIENT_ID?.slice(0, 8)}...`);

// 1. Get token
const tokenRes = await fetch(`${base}/v1/token`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_Id: vars.SEVERA_CLIENT_ID,
    client_Secret: vars.SEVERA_CLIENT_SECRET,
    scope: "customers:read projects:read users:read hours:read",
  }),
});

if (!tokenRes.ok) {
  console.error("Token request failed:", tokenRes.status, await tokenRes.text());
  process.exit(1);
}

const { access_token, access_token_expires_in } = await tokenRes.json();
console.log(`\nToken OK (expires in ${access_token_expires_in}s): ${access_token.slice(0, 20)}...`);

// 2. Fetch one user
const usersRes = await fetch(`${base}/v1/users?rowCount=3`, {
  headers: { authorization: `Bearer ${access_token}`, accept: "application/json" },
});

if (!usersRes.ok) {
  console.error("Users request failed:", usersRes.status, await usersRes.text());
  process.exit(1);
}

const users = await usersRes.json();
console.log(`\n/v1/users (first 3):`);
for (const u of users) {
  console.log(`  ${u.firstName} ${u.lastName} <${u.email}> [${u.guid}]`);
}
