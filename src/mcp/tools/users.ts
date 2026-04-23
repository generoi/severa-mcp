import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { UserOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import { toText } from "../format";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export function registerUserTools(server: McpServer, env: Env) {
  server.registerTool(
    "severa_list_users",
    {
      description: [
        "List Severa users from `/v1/users`. Use this (not `severa_find_user`) when you want to filter by business unit, keyword, supervisor, or get paginated bulk lists.",
        "",
        "Server-side filters:",
        "- `isActive`",
        "- `businessUnitGuids` — via `severa_query({ path: '/v1/businessunits' })`",
        "- `keywordGuids` — via `severa_query({ path: '/v1/keywords' })`",
        "- `supervisorUserGuids`",
        "- `code` — user code (exact)",
        "- `email` — exact",
        "- `purpose` — enum",
        "- `changedSince` — YYYY-MM-DD",
        "",
        "Client-side:",
        "- `nameContains`, `emailContains`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        isActive: z.boolean().optional(),
        businessUnitGuids: z.array(uuid).optional(),
        keywordGuids: z.array(uuid).optional(),
        supervisorUserGuids: z.array(uuid).optional(),
        code: z.string().optional(),
        email: z.string().email().optional(),
        purpose: z.string().optional(),
        changedSince: isoDate.optional(),
        nameContains: z.string().min(1).optional(),
        emailContains: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List users" },
    },
    async (args) => {
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<UserOutputModel>(env, "/v1/users", {
        query: {
          ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
          ...(args.businessUnitGuids?.length ? { businessUnitGuids: args.businessUnitGuids } : {}),
          ...(args.keywordGuids?.length ? { keywordGuids: args.keywordGuids } : {}),
          ...(args.supervisorUserGuids?.length
            ? { supervisorUserGuids: args.supervisorUserGuids }
            : {}),
          ...(args.code ? { code: args.code } : {}),
          ...(args.email ? { email: args.email } : {}),
          ...(args.purpose ? { purpose: args.purpose } : {}),
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((u) => {
          if (args.nameContains) {
            if (
              !matches(u.firstName, args.nameContains) &&
              !matches(u.lastName, args.nameContains) &&
              !matches(u.userName, args.nameContains)
            ) {
              return false;
            }
          }
          if (args.emailContains && !matches(u.email, args.emailContains)) return false;
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No users match those filters.");
      return toText(
        `${hits.length} user(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""}:\n${hits.map(renderUserRow).join("\n")}`,
      );
    },
  );
}

function renderUserRow(u: UserOutputModel): string {
  const fullName =
    [u.firstName, u.lastName].filter(Boolean).join(" ") || u.userName || "(unnamed)";
  const parts = [
    `**${fullName}**`,
    u.email,
    u.title,
    u.businessUnit?.name,
    u.isActive === false ? "(inactive)" : undefined,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${u.guid}\``;
}
