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
  customerGuid: uuid.nullish(),
  salesPersonGuid: uuid.nullish(),
  projectOwnerGuid: uuid.nullish(),
  onlyMine: z.boolean().nullish(), // resolves to salesPersonGuid = signed-in user

  // server-side array filters
  customerGuids: z.array(uuid).nullish(),
  salesPersonGuids: z.array(uuid).nullish(),
  projectOwnerGuids: z.array(uuid).nullish(),
  customerOwnerGuids: z.array(uuid).nullish(),
  projectGuids: z.array(uuid).nullish(),
  projectKeywordGuids: z.array(uuid).nullish(),
  projectStatusTypeGuids: z.array(uuid).nullish(),
  salesStatusTypeGuids: z.array(uuid).nullish(),
  businessUnitGuids: z.array(uuid).nullish(),
  marketSegmentationGuids: z.array(uuid).nullish(),
  companyCurrencyGuids: z.array(uuid).nullish(),
  currencyGuids: z.array(uuid).nullish(),
  projectMemberUserGuids: z.array(uuid).nullish(),
  numbers: z.array(z.number().int()).nullish(),

  // server-side scalar filters
  isClosed: z.boolean().nullish(),
  hasRecurringFees: z.boolean().nullish(),
  minimumBillableAmount: z.number().nullish(),
  invoiceableDate: isoDate.nullish(),

  // client-side
  isWon: z.boolean().nullish(),
  nameContains: z.string().min(1).nullish(),
  statusNameContains: z.string().min(1).nullish(),
  closedFrom: isoDate.nullish(),
  closedTo: isoDate.nullish(),

  limit: z.number().int().min(1).max(500).nullish(),
} as const;

// /v1/projects adds these on top:
export const projectsExtraFilters = {
  currencyGuid: uuid.nullish(),
  changedSince: isoDate.nullish(),
  salesStatusChangedSince: isoDate.nullish(),
  projectStatusChangedSince: isoDate.nullish(),
  isBillable: z.boolean().nullish(),
  internal: z.boolean().nullish(),

  // client-side
  expectedOrderFrom: isoDate.nullish(),
  expectedOrderTo: isoDate.nullish(),
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

function mergeGuid(
  single?: string | null,
  plural?: string[] | null,
): string[] | undefined {
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

  const withTime = (d?: string | null): string | undefined =>
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
    ...(args.isClosed != null ? { isClosed: args.isClosed } : {}),
    ...(args.hasRecurringFees != null ? { hasRecurringFees: args.hasRecurringFees } : {}),
    ...(args.minimumBillableAmount != null
      ? { minimumBillableAmount: args.minimumBillableAmount }
      : {}),
    ...(args.invoiceableDate ? { invoiceableDate: args.invoiceableDate } : {}),
    // projects-only
    ...(args.currencyGuid ? { currencyGuid: args.currencyGuid } : {}),
    ...(args.isBillable != null ? { isBillable: args.isBillable } : {}),
    ...(args.internal != null ? { internal: args.internal } : {}),
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
    if (args.isWon != null && p.salesStatus?.isWon !== args.isWon) return false;
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
