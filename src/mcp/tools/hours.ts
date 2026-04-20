import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import { helsinkiToday, helsinkiWeekRange } from "../../severa/dates";
import type { WorkHourOutputModel } from "../../severa/types";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import { toText } from "../format";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function registerHoursReadTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_get_my_hours",
    {
      description:
        "List the signed-in user's work hours in a date range. Defaults to the current week (Europe/Helsinki).",
      inputSchema: {
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
      annotations: { ...READ_ANNOTATIONS, title: "Get my hours" },
    },
    async ({ from, to }) => {
      const userGuid = await requireSeveraUserGuid(env, props.email);
      const range = from && to ? { from, to } : helsinkiWeekRange();
      const rows = await severaPaginate<WorkHourOutputModel>(
        env,
        `/v1/users/${userGuid}/workhours`,
        {
          query: { startDate: range.from, endDate: range.to, rowCount: 500 },
        },
      );
      if (!rows.length)
        return toText(`No work hours for ${props.email} between ${range.from} and ${range.to}.`);
      const totalHours = rows.reduce((s, r) => s + r.quantity, 0);
      const byProject = new Map<string, number>();
      for (const r of rows) {
        const k = r.project.name;
        byProject.set(k, (byProject.get(k) ?? 0) + r.quantity);
      }
      const breakdown = [...byProject.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, h]) => `- ${name}: **${h.toFixed(2)}h**`)
        .join("\n");
      return toText(
        `**${totalHours.toFixed(2)}h** logged ${range.from} → ${range.to}\n\nBy project:\n${breakdown}`,
      );
    },
  );

  server.registerTool(
    "severa_get_unbilled_hours",
    {
      description:
        "Sum billable-but-not-yet-invoiced work-hour quantity for a given project.",
      inputSchema: { projectGuid: z.string().uuid() },
      annotations: { ...READ_ANNOTATIONS, title: "Get unbilled hours" },
    },
    async ({ projectGuid }) => {
      const rows = await severaPaginate<WorkHourOutputModel>(
        env,
        `/v1/projects/${projectGuid}/workhours`,
        {
          query: { isBillable: true, isBilled: false, rowCount: 1000 },
        },
      );
      if (!rows.length) return toText("No unbilled hours on this project.");
      const total = rows.reduce((s, r) => s + r.quantity, 0);
      const byUser = new Map<string, number>();
      for (const r of rows) {
        const name =
          [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") ||
          r.user.email ||
          r.user.userName ||
          r.user.guid;
        byUser.set(name, (byUser.get(name) ?? 0) + r.quantity);
      }
      const breakdown = [...byUser.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, h]) => `- ${name}: **${h.toFixed(2)}h**`)
        .join("\n");
      return toText(`**${total.toFixed(2)}h** unbilled\n\n${breakdown}`);
    },
  );
}

export function registerHoursWriteTools(server: McpServer, env: Env, props: SessionProps) {
  server.registerTool(
    "severa_log_hours",
    {
      description:
        "Log a work-hour entry for the signed-in user. Requires a phaseGuid (phases belong to projects) and a workTypeGuid.",
      inputSchema: {
        phaseGuid: z.string().uuid(),
        workTypeGuid: z.string().uuid(),
        quantity: z.number().positive().max(24),
        eventDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("YYYY-MM-DD (Europe/Helsinki). Defaults to today."),
        description: z.string().optional(),
        isBillable: z.boolean().optional(),
      },
      annotations: { ...WRITE_ANNOTATIONS, title: "Log work hours" },
    },
    async ({ phaseGuid, workTypeGuid, quantity, eventDate, description, isBillable }) => {
      const userGuid = await requireSeveraUserGuid(env, props.email);
      const body = {
        user: { guid: userGuid },
        phase: { guid: phaseGuid },
        workType: { guid: workTypeGuid },
        quantity,
        eventDate: eventDate ?? helsinkiToday(),
        ...(description ? { description } : {}),
        ...(isBillable !== undefined ? { isBillable } : {}),
      };
      const created = await severaFetch<WorkHourOutputModel>(env, "/v1/workhours", {
        method: "POST",
        body,
      });
      return toText(
        `Logged ${quantity}h on ${body.eventDate} to ${created.project?.name ?? "project"}. Entry GUID: \`${created.guid}\``,
      );
    },
  );
}

export function registerHoursTools(
  server: McpServer,
  env: Env,
  props: SessionProps,
  opts: { enableWrites: boolean },
) {
  registerHoursReadTools(server, env, props);
  if (opts.enableWrites) registerHoursWriteTools(server, env, props);
}
