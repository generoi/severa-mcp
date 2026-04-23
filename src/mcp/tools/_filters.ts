import { z } from "zod";
import type { ProjectOutputModel } from "../../severa/types";
import { matches } from "../../severa/reference-cache";

// Filters shared by /v1/salescases and /v1/projects (nearly identical filter
// sets — projects adds a handful of date-since filters and the currency
// singular shortcut).
//
// We expose every server-side filter the Severa endpoint accepts, plus a few
// client-side conveniences (nameContains, statusNameContains, closedFrom/To,
// expectedOrderFrom/To) that are not available server-side.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

// Shared by both /v1/salescases and /v1/projects.
export const projectFiltersBase = {
  // identity shortcuts (singular) — merge into the corresponding *Guids array
  customerGuid: uuid.optional(),
  salesPersonGuid: uuid.optional(),
  projectOwnerGuid: uuid.optional(),
  onlyMine: z.boolean().optional(), // resolves to salesPersonGuid = signed-in user

  // server-side array filters
  customerGuids: z.array(uuid).optional(),
  salesPersonGuids: z.array(uuid).optional(),
  projectOwnerGuids: z.array(uuid).optional(),
  customerOwnerGuids: z.array(uuid).optional(),
  projectGuids: z.array(uuid).optional(),
  projectKeywordGuids: z.array(uuid).optional(),
  projectStatusTypeGuids: z.array(uuid).optional(),
  salesStatusTypeGuids: z.array(uuid).optional(),
  businessUnitGuids: z.array(uuid).optional(),
  marketSegmentationGuids: z.array(uuid).optional(),
  companyCurrencyGuids: z.array(uuid).optional(),
  currencyGuids: z.array(uuid).optional(),
  projectMemberUserGuids: z.array(uuid).optional(),
  numbers: z.array(z.number().int()).optional(),

  // server-side scalar filters
  isClosed: z.boolean().optional(),
  hasRecurringFees: z.boolean().optional(),
  minimumBillableAmount: z.number().optional(),
  invoiceableDate: isoDate.optional(),

  // client-side
  isWon: z.boolean().optional(),
  nameContains: z.string().min(1).optional(),
  statusNameContains: z.string().min(1).optional(),
  closedFrom: isoDate.optional(),
  closedTo: isoDate.optional(),

  limit: z.number().int().min(1).max(500).optional(),
} as const;

// /v1/projects adds these on top:
export const projectsExtraFilters = {
  currencyGuid: uuid.optional(),
  changedSince: isoDate.optional(),
  salesStatusChangedSince: isoDate.optional(),
  projectStatusChangedSince: isoDate.optional(),
  isBillable: z.boolean().optional(),
  internal: z.boolean().optional(),

  // client-side
  expectedOrderFrom: isoDate.optional(),
  expectedOrderTo: isoDate.optional(),
} as const;

export type ProjectFiltersBase = {
  [K in keyof typeof projectFiltersBase]?: z.infer<(typeof projectFiltersBase)[K]>;
};
export type ProjectsExtraFilters = {
  [K in keyof typeof projectsExtraFilters]?: z.infer<(typeof projectsExtraFilters)[K]>;
};

export interface BuildQueryOptions {
  effectiveSalesPerson?: string; // resolved from onlyMine if given
  limit: number;
}

function mergeGuid(single?: string, plural?: string[]): string[] | undefined {
  const xs = [...(single ? [single] : []), ...(plural ?? [])];
  return xs.length ? xs : undefined;
}

export function buildProjectsServerQuery(
  args: ProjectFiltersBase & ProjectsExtraFilters,
  opts: BuildQueryOptions,
): Record<string, string | number | boolean | string[] | undefined> {
  const customerGuids = mergeGuid(args.customerGuid, args.customerGuids);
  const salesPersonGuids = opts.effectiveSalesPerson
    ? [opts.effectiveSalesPerson]
    : mergeGuid(args.salesPersonGuid, args.salesPersonGuids);
  const projectOwnerGuids = mergeGuid(args.projectOwnerGuid, args.projectOwnerGuids);

  const withTime = (d?: string): string | undefined =>
    d ? `${d}T00:00:00Z` : undefined;

  const query: Record<string, string | number | boolean | string[] | undefined> = {
    ...(customerGuids ? { customerGuids } : {}),
    ...(salesPersonGuids ? { salesPersonGuids } : {}),
    ...(projectOwnerGuids ? { projectOwnerGuids } : {}),
    ...(args.customerOwnerGuids?.length ? { customerOwnerGuids: args.customerOwnerGuids } : {}),
    ...(args.projectGuids?.length ? { projectGuids: args.projectGuids } : {}),
    ...(args.projectKeywordGuids?.length ? { projectKeywordGuids: args.projectKeywordGuids } : {}),
    ...(args.projectStatusTypeGuids?.length
      ? { projectStatusTypeGuids: args.projectStatusTypeGuids }
      : {}),
    ...(args.salesStatusTypeGuids?.length
      ? { salesStatusTypeGuids: args.salesStatusTypeGuids }
      : {}),
    ...(args.businessUnitGuids?.length ? { businessUnitGuids: args.businessUnitGuids } : {}),
    ...(args.marketSegmentationGuids?.length
      ? { marketSegmentationGuids: args.marketSegmentationGuids }
      : {}),
    ...(args.companyCurrencyGuids?.length
      ? { companyCurrencyGuids: args.companyCurrencyGuids }
      : {}),
    ...(args.currencyGuids?.length ? { currencyGuids: args.currencyGuids } : {}),
    ...(args.projectMemberUserGuids?.length
      ? { projectMemberUserGuids: args.projectMemberUserGuids }
      : {}),
    ...(args.numbers?.length ? { numbers: args.numbers.map(String) } : {}),
    ...(args.isClosed !== undefined ? { isClosed: args.isClosed } : {}),
    ...(args.hasRecurringFees !== undefined ? { hasRecurringFees: args.hasRecurringFees } : {}),
    ...(args.minimumBillableAmount !== undefined
      ? { minimumBillableAmount: args.minimumBillableAmount }
      : {}),
    ...(args.invoiceableDate ? { invoiceableDate: args.invoiceableDate } : {}),
    // projects-only
    ...(args.currencyGuid ? { currencyGuid: args.currencyGuid } : {}),
    ...(args.isBillable !== undefined ? { isBillable: args.isBillable } : {}),
    ...(args.internal !== undefined ? { internal: args.internal } : {}),
    ...(withTime(args.changedSince) ? { changedSince: withTime(args.changedSince)! } : {}),
    ...(withTime(args.salesStatusChangedSince)
      ? { salesStatusChangedSince: withTime(args.salesStatusChangedSince)! }
      : {}),
    ...(withTime(args.projectStatusChangedSince)
      ? { projectStatusChangedSince: withTime(args.projectStatusChangedSince)! }
      : {}),
    rowCount: Math.min(1000, Math.max(opts.limit, 100)),
  };
  return query;
}

export function applyProjectClientFilters(
  rows: ProjectOutputModel[],
  args: ProjectFiltersBase & ProjectsExtraFilters,
  opts: { limit: number },
): ProjectOutputModel[] {
  const filtered = rows.filter((p) => {
    if (args.isWon !== undefined && p.salesStatus?.isWon !== args.isWon) return false;
    if (args.nameContains) {
      const match =
        matches(p.name, args.nameContains) ||
        matches(p.customer?.name, args.nameContains) ||
        matches(p.number, args.nameContains);
      if (!match) return false;
    }
    if (args.statusNameContains && !matches(p.salesStatus?.name, args.statusNameContains)) {
      return false;
    }
    if (args.closedFrom || args.closedTo) {
      const d = p.closedDate?.slice(0, 10);
      if (!d) return false;
      if (args.closedFrom && d < args.closedFrom) return false;
      if (args.closedTo && d > args.closedTo) return false;
    }
    if (args.expectedOrderFrom || args.expectedOrderTo) {
      const d = p.expectedOrderDate?.slice(0, 10);
      if (!d) return false;
      if (args.expectedOrderFrom && d < args.expectedOrderFrom) return false;
      if (args.expectedOrderTo && d > args.expectedOrderTo) return false;
    }
    return true;
  });
  return filtered.slice(0, opts.limit);
}
