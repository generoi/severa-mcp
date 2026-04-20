import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import {
  getActiveCustomers,
  getActiveProjects,
  matches,
} from "../../severa/reference-cache";
import type { Env } from "../../env";
import type { CustomerModel, ProjectOutputModel, UserWithName } from "../../severa/types";
import { toJsonBlock, toText } from "../format";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerLookupTools(server: McpServer, env: Env) {
  server.registerTool(
    "severa_find_customer",
    {
      description:
        "Find Severa customers whose name contains the given text (case-insensitive). Searches the active customer list. Use to resolve a customer name into a GUID.",
      inputSchema: {
        text: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find customer" },
    },
    async ({ text, limit = 15 }) => {
      const all = await getActiveCustomers(env);
      const hits = all
        .filter((c) => matches(c.name, text) || matches(c.code, text) || matches(c.number, text))
        .slice(0, limit);
      if (!hits.length) return toText(`No active customers matching "${text}".`);
      const lines = hits.map(
        (c) => `- ${c.name}${c.code ? ` (${c.code})` : ""} — \`${c.guid}\``,
      );
      return toText(`Found ${hits.length} customer(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "severa_find_project",
    {
      description:
        "Find open Severa projects whose name contains the given text (case-insensitive). Optionally scope to a customer GUID.",
      inputSchema: {
        text: z.string().min(1),
        customerGuid: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find project" },
    },
    async ({ text, customerGuid, limit = 15 }) => {
      const all = await getActiveProjects(env);
      const scoped = customerGuid ? all.filter((p) => p.customer?.guid === customerGuid) : all;
      const hits = scoped
        .filter((p) => matches(p.name, text) || matches(p.number, text))
        .slice(0, limit);
      if (!hits.length) return toText(`No open projects matching "${text}".`);
      const lines = hits.map(
        (p) =>
          `- ${p.name}${p.number ? ` [${p.number}]` : ""}${
            p.customer ? ` — ${p.customer.name}` : ""
          } — \`${p.guid}\``,
      );
      return toText(`Found ${hits.length} project(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "severa_find_user",
    {
      description:
        "Find Severa users by email (exact) or by free-text match against name. Returns GUID, name, email.",
      inputSchema: {
        email: z.string().email().optional(),
        text: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Find user" },
    },
    async ({ email, text, limit = 15 }) => {
      if (!email && !text) return toText("Provide at least `email` or `text`.");
      const users = email
        ? await severaPaginate<UserWithName>(env, "/v1/users", { query: { email, rowCount: 25 } })
        : await severaPaginate<UserWithName>(env, "/v1/users", {
            query: { isActive: true, rowCount: 500 },
          });
      const filtered = text
        ? users.filter(
            (u) =>
              matches(u.firstName, text) ||
              matches(u.lastName, text) ||
              matches(u.userName, text) ||
              matches(u.email, text),
          )
        : users;
      const hits = filtered.slice(0, limit);
      if (!hits.length) return toText("No users matched.");
      const lines = hits.map(
        (u) =>
          `- ${[u.firstName, u.lastName].filter(Boolean).join(" ") || u.userName || u.email || "(unnamed)"} — ${u.email ?? "no email"} — \`${u.guid}\``,
      );
      return toText(`Found ${hits.length} user(s):\n${lines.join("\n")}`);
    },
  );

  server.registerTool(
    "severa_get_project",
    {
      description: "Fetch full details for a Severa project by GUID, including phases and sales fields.",
      inputSchema: { projectGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get project" },
    },
    async ({ projectGuid }) => {
      const project = await severaFetch<ProjectOutputModel>(env, `/v1/projects/${projectGuid}`);
      return toJsonBlock(`Project: ${project.name}`, project);
    },
  );

  server.registerTool(
    "severa_get_customer",
    {
      description: "Fetch full details for a Severa customer by GUID.",
      inputSchema: { customerGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get customer" },
    },
    async ({ customerGuid }) => {
      const customer = await severaFetch<CustomerModel>(env, `/v1/customers/${customerGuid}`);
      return toJsonBlock(`Customer: ${customer.name}`, customer);
    },
  );
}
