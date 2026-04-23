import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaPaginate } from "../../severa/client";
import { matches } from "../../severa/reference-cache";
import type { ProjectFeeOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import { formatMoney, toText } from "../format";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export function registerFeeTools(server: McpServer, env: Env) {
  server.registerTool(
    "severa_list_project_fees",
    {
      description: [
        "List project fees from `/v1/projectfees` (needs `fees:read` scope, already requested).",
        "",
        "Server-side filter is thin — only `changedSince`. For project- or user-scoped queries, prefer `severa_query`:",
        "- `/v1/projects/{projectGuid}/projectfees`",
        "- `/v1/users/{userGuid}/projectfees`",
        "",
        "Client-side filters (post-fetch):",
        "- `projectGuid`, `userGuid`",
        "- `descriptionContains`",
        "- `eventDateFrom` / `eventDateTo` — YYYY-MM-DD range",
        "- `billableStatus`",
        "",
        "`limit` default 100, max 500.",
      ].join("\n"),
      inputSchema: {
        changedSince: isoDate.nullish(),
        projectGuid: uuid.nullish(),
        userGuid: uuid.nullish(),
        descriptionContains: z.string().min(1).nullish(),
        eventDateFrom: isoDate.nullish(),
        eventDateTo: isoDate.nullish(),
        billableStatus: z
          .enum(["Billable", "NotBillable", "RemovedFromInvoice"])
          .nullish(),
        limit: z.number().int().min(1).max(500).nullish(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "List project fees" },
    },
    async (args) => {
      const limit = args.limit ?? 100;
      const rows = await severaPaginate<ProjectFeeOutputModel>(env, "/v1/projectfees", {
        query: {
          ...(args.changedSince ? { changedSince: `${args.changedSince}T00:00:00Z` } : {}),
          rowCount: Math.min(1000, Math.max(limit, 100)),
        },
      });

      const hits = rows
        .filter((r) => {
          if (args.projectGuid && r.project?.guid !== args.projectGuid) return false;
          if (args.userGuid && r.user?.guid !== args.userGuid) return false;
          if (args.descriptionContains && !matches(r.description, args.descriptionContains))
            return false;
          if (args.billableStatus && r.billableStatus !== args.billableStatus) return false;
          if (args.eventDateFrom || args.eventDateTo) {
            const d = r.eventDate?.slice(0, 10);
            if (!d) return false;
            if (args.eventDateFrom && d < args.eventDateFrom) return false;
            if (args.eventDateTo && d > args.eventDateTo) return false;
          }
          return true;
        })
        .slice(0, limit);

      if (!hits.length) return toText("No project fees match those filters.");
      const total = hits.reduce((s, r) => s + (r.totalPrice?.amount ?? 0), 0);
      const currency =
        hits.find((r) => r.totalPrice?.currencyCode)?.totalPrice?.currencyCode ?? "EUR";
      return toText(
        `${hits.length} fee(s)${hits.length < rows.length ? ` (of ${rows.length} fetched)` : ""} — total ${total.toLocaleString("sv-FI")} ${currency}:\n${hits.map(renderFeeRow).join("\n")}`,
      );
    },
  );
}

function renderFeeRow(r: ProjectFeeOutputModel): string {
  const parts = [
    r.eventDate?.slice(0, 10),
    r.project?.name,
    r.description,
    r.quantity != null ? `${r.quantity}x` : undefined,
    formatMoney(r.totalPrice),
    r.billableStatus,
  ].filter(Boolean);
  return `- ${parts.join(" — ")} — \`${r.guid}\``;
}
