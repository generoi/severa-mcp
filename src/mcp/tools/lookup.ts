import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import {
  getActiveCustomers,
  getActiveProjects,
  matches,
} from "../../severa/reference-cache";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import type { CustomerModel, Money, ProjectOutputModel, UserWithName } from "../../severa/types";
import { formatMoney, toJsonBlock, toText } from "../format";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function registerLookupTools(server: McpServer, env: Env, props: SessionProps) {
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

  server.registerTool(
    "severa_list_customers",
    {
      description: [
        "List Severa customers from `/v1/customers` with the full filter set the endpoint supports. Use this (not `severa_find_customer`) when you need filters beyond a name substring — e.g. customer-owner, inactive customers, date-based changes, or exact-match by email/VAT/name.",
        "",
        "Server-side filters (sent to Severa):",
        "- `isActive` — omit = all, true = only active, false = only inactive",
        "- `isInternal` — internal customers (e.g. Genero itself)",
        "- `customerOwnerGuid` — resolve via `severa_find_user`",
        "- `changedSince` — YYYY-MM-DD; customers updated since this date",
        "- `emailAddresses` — exact-match array (any contact email)",
        "- `customerNames` — exact-match array",
        "- `vatNumber` — exact match",
        "- `numbers` — array of Severa customer numbers",
        "",
        "Client-side filter:",
        "- `nameContains` — substring of customer name or code (case-insensitive)",
        "",
        "Use `limit` to cap the displayed list (default 100, max 500). Returns a list with name, code, number, and GUID.",
      ].join("\n"),
      inputSchema: {
        isActive: z.boolean().optional(),
        isInternal: z.boolean().optional(),
        customerOwnerGuid: z.string().uuid().optional(),
        changedSince: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        emailAddresses: z.array(z.string().email()).optional(),
        customerNames: z.array(z.string().min(1)).optional(),
        vatNumber: z.string().optional(),
        numbers: z.array(z.number().int()).optional(),
        nameContains: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List customers" },
    },
    async (args) => {
      const {
        isActive,
        isInternal,
        customerOwnerGuid,
        changedSince,
        emailAddresses,
        customerNames,
        vatNumber,
        numbers,
        nameContains,
        limit = 100,
      } = args;

      const customers = await severaPaginate<CustomerModel>(env, "/v1/customers", {
        query: {
          ...(isActive !== undefined ? { isActive } : {}),
          ...(isInternal !== undefined ? { isInternal } : {}),
          ...(customerOwnerGuid ? { customerOwnerGuids: [customerOwnerGuid] } : {}),
          ...(changedSince ? { changedSince: `${changedSince}T00:00:00Z` } : {}),
          ...(emailAddresses?.length ? { emailAddresses } : {}),
          ...(customerNames?.length ? { customerNames } : {}),
          ...(vatNumber ? { vatNumber } : {}),
          ...(numbers?.length ? { numbers: numbers.map(String) } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = customers
        .filter((c) => {
          if (nameContains) {
            if (!matches(c.name, nameContains) && !matches(c.code, nameContains)) {
              return false;
            }
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No customers match those filters.");
      const lines = hits.map(
        (c) =>
          `- ${c.name}${c.code ? ` (${c.code})` : ""}${c.number ? ` [#${c.number}]` : ""} — \`${c.guid}\``,
      );
      return toText(
        `${hits.length} customer(s)${hits.length < customers.length ? ` (of ${customers.length} fetched)` : ""}:\n${lines.join("\n")}`,
      );
    },
  );

  server.registerTool(
    "severa_list_projects",
    {
      description: [
        "List Severa projects from `/v1/projects` with the full filter set the endpoint supports.",
        "",
        "IMPORTANT: at some Severa setups (including Genero), cases that reach a Won status like 'Order / NB' are listed under `/v1/projects`, NOT under `/v1/salescases`. If `severa_list_sales_cases` returns nothing for a Won-status question, use this tool instead.",
        "",
        "TIP: `/v1/projects` contains lots of historical data. When filtering by `salesStatusTypeGuids` alone you may hit the 2000-row pagination ceiling before reaching recent matches. Pair status filters with a date filter (`salesStatusChangedSince` is usually the right one for 'marked as X in period Y' questions) to narrow the result set server-side.",
        "",
        "Server-side filters (sent to Severa):",
        "- `customerGuid`, `salesPersonGuid`, `projectOwnerGuid` — resolve via `severa_find_customer` / `severa_find_user`",
        "- `onlyMine` — shortcut for salesPersonGuid = signed-in user",
        "- `salesStatusTypeGuids` — resolve via `severa_query({ path: '/v1/salesstatustypes' })`",
        "- `projectStatusTypeGuids` — resolve via `severa_query({ path: '/v1/projectstatustypes' })`",
        "- `projectKeywordGuids` — resolve via `severa_query({ path: '/v1/keywords' })`",
        "- `businessUnitGuids` — resolve via `severa_query({ path: '/v1/businessunits' })`",
        "- `isClosed` / `isBillable` / `internal` / `hasRecurringFees`",
        "- `salesStatusChangedSince` / `projectStatusChangedSince` / `changedSince` — YYYY-MM-DD (answers 'marked as X this month/year')",
        "- `numbers` — array of project numbers (int)",
        "",
        "Client-side filters (applied after fetch):",
        "- `nameContains` — substring of project name, customer name, or project number",
        "- `statusNameContains` — substring of sales-status name (e.g. 'NB', 'EB', 'Order')",
        "- `expectedOrderFrom` / `expectedOrderTo` — YYYY-MM-DD range on `expectedOrderDate`",
        "- `closedFrom` / `closedTo` — YYYY-MM-DD range on `closedDate`",
        "",
        "Use `limit` to cap the displayed list (default 100, max 500). Returns a formatted list with name, customer, sales status, probability, expected value, expected order / closed date, and GUID.",
      ].join("\n"),
      inputSchema: {
        customerGuid: z.string().uuid().optional(),
        salesPersonGuid: z.string().uuid().optional(),
        projectOwnerGuid: z.string().uuid().optional(),
        onlyMine: z.boolean().optional(),
        salesStatusTypeGuids: z.array(z.string().uuid()).optional(),
        projectStatusTypeGuids: z.array(z.string().uuid()).optional(),
        projectKeywordGuids: z.array(z.string().uuid()).optional(),
        businessUnitGuids: z.array(z.string().uuid()).optional(),
        isClosed: z.boolean().optional(),
        isBillable: z.boolean().optional(),
        internal: z.boolean().optional(),
        hasRecurringFees: z.boolean().optional(),
        salesStatusChangedSince: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        projectStatusChangedSince: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        changedSince: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        numbers: z.array(z.number().int()).optional(),
        nameContains: z.string().min(1).optional(),
        statusNameContains: z.string().min(1).optional(),
        expectedOrderFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        expectedOrderTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        closedFrom: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        closedTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List projects" },
    },
    async (args) => {
      const {
        customerGuid,
        salesPersonGuid,
        projectOwnerGuid,
        onlyMine,
        salesStatusTypeGuids,
        projectStatusTypeGuids,
        projectKeywordGuids,
        businessUnitGuids,
        isClosed,
        isBillable,
        internal,
        hasRecurringFees,
        salesStatusChangedSince,
        projectStatusChangedSince,
        changedSince,
        numbers,
        nameContains,
        statusNameContains,
        expectedOrderFrom,
        expectedOrderTo,
        closedFrom,
        closedTo,
        limit = 100,
      } = args;

      const effectiveSalesPerson =
        salesPersonGuid ??
        (onlyMine ? await requireSeveraUserGuid(env, props.email) : undefined);

      const projects = await severaPaginate<ProjectOutputModel>(env, "/v1/projects", {
        query: {
          ...(customerGuid ? { customerGuids: [customerGuid] } : {}),
          ...(effectiveSalesPerson ? { salesPersonGuids: [effectiveSalesPerson] } : {}),
          ...(projectOwnerGuid ? { projectOwnerGuids: [projectOwnerGuid] } : {}),
          ...(salesStatusTypeGuids?.length ? { salesStatusTypeGuids } : {}),
          ...(projectStatusTypeGuids?.length ? { projectStatusTypeGuids } : {}),
          ...(projectKeywordGuids?.length ? { projectKeywordGuids } : {}),
          ...(businessUnitGuids?.length ? { businessUnitGuids } : {}),
          ...(isClosed !== undefined ? { isClosed } : {}),
          ...(isBillable !== undefined ? { isBillable } : {}),
          ...(internal !== undefined ? { internal } : {}),
          ...(hasRecurringFees !== undefined ? { hasRecurringFees } : {}),
          ...(salesStatusChangedSince
            ? { salesStatusChangedSince: `${salesStatusChangedSince}T00:00:00Z` }
            : {}),
          ...(projectStatusChangedSince
            ? { projectStatusChangedSince: `${projectStatusChangedSince}T00:00:00Z` }
            : {}),
          ...(changedSince ? { changedSince: `${changedSince}T00:00:00Z` } : {}),
          ...(numbers?.length ? { numbers: numbers.map(String) } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = projects
        .filter((p) => {
          if (nameContains) {
            const match =
              matches(p.name, nameContains) ||
              matches(p.customer?.name, nameContains) ||
              matches(p.number, nameContains);
            if (!match) return false;
          }
          if (statusNameContains && !matches(p.salesStatus?.name, statusNameContains)) {
            return false;
          }
          if (expectedOrderFrom || expectedOrderTo) {
            const d = p.expectedOrderDate?.slice(0, 10);
            if (!d) return false;
            if (expectedOrderFrom && d < expectedOrderFrom) return false;
            if (expectedOrderTo && d > expectedOrderTo) return false;
          }
          if (closedFrom || closedTo) {
            const d = p.closedDate?.slice(0, 10);
            if (!d) return false;
            if (closedFrom && d < closedFrom) return false;
            if (closedTo && d > closedTo) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No projects match those filters.");
      const totalRaw = hits.reduce((s, p) => s + (p.expectedValue?.amount ?? 0), 0);
      const currency =
        hits.find((p) => p.expectedValue?.currencyCode)?.expectedValue?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} project(s)${hits.length < projects.length ? ` (of ${projects.length} fetched)` : ""} — total ${totalRaw.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderProjectRow).join("\n")}`,
      );
    },
  );
}

function renderProjectRow(p: ProjectOutputModel): string {
  const parts: (string | undefined)[] = [
    `**${p.name}**`,
    p.customer?.name,
    p.salesStatus?.name,
    p.probability !== undefined ? `${p.probability}%` : undefined,
    formatMoney(p.expectedValue as Money | undefined),
    p.expectedOrderDate ? `order ${p.expectedOrderDate.slice(0, 10)}` : undefined,
    p.closedDate ? `closed ${p.closedDate.slice(0, 10)}` : undefined,
  ];
  return `- ${parts.filter(Boolean).join(" — ")} — \`${p.guid}\``;
}
