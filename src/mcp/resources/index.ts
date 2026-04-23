import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { severaFetch, severaPaginate } from "../../severa/client";
import { requireSeveraUserGuid } from "../../severa/user-resolver";
import type { Env } from "../../env";
import type { SessionProps } from "../../auth/session";
import type { UserOutputModel } from "../../severa/types";

// Maps a `severa://reference/{slug}` URI to the underlying /v1/* endpoint.
// The slug list is also the advertised `resources/list` output.
const REFERENCE_ENDPOINTS: Record<string, { path: string; description: string }> = {
  "sales-status-types": {
    path: "/v1/salesstatustypes",
    description: "Sales status types (InProgress / Won / Lost). Filter by `salesState`.",
  },
  "project-status-types": {
    path: "/v1/projectstatustypes",
    description: "Project status types.",
  },
  "phase-status-types": { path: "/v1/phasestatustypes", description: "Phase status types." },
  "project-task-statuses": {
    path: "/v1/projecttaskstatuses",
    description: "Project task statuses.",
  },
  "invoice-statuses": { path: "/v1/invoicestatuses", description: "Invoice statuses." },
  "proposal-statuses": { path: "/v1/proposalstatuses", description: "Proposal statuses." },
  "travel-reimbursement-statuses": {
    path: "/v1/travelreimbursementstatuses",
    description: "Travel reimbursement statuses.",
  },
  "work-types": { path: "/v1/worktypes", description: "Work types (for logging hours)." },
  "activity-types": { path: "/v1/activitytypes", description: "Activity types (CRM)." },
  "time-entry-types": {
    path: "/v1/timeentrytypes",
    description: "Time entry types (punch-clock).",
  },
  "travel-expense-types": {
    path: "/v1/travelexpensetypes",
    description: "Travel expense categories.",
  },
  "business-units": { path: "/v1/businessunits", description: "Business units." },
  "cost-centers": { path: "/v1/costcenters", description: "Cost centers." },
  currencies: { path: "/v1/currencies", description: "Currencies." },
  "vat-rates": { path: "/v1/vatrates", description: "VAT rates." },
  keywords: { path: "/v1/keywords", description: "Project and user keywords (tags)." },
  "lead-sources": { path: "/v1/leadsources", description: "Lead sources." },
  "market-segments": { path: "/v1/marketsegments", description: "Market segments." },
  industries: { path: "/v1/industries", description: "Industries." },
  pricelists: { path: "/v1/pricelists", description: "Price lists." },
  "product-categories": {
    path: "/v1/productcategories",
    description: "Product categories.",
  },
  "permission-profiles": {
    path: "/v1/permissionprofiles",
    description: "Permission profiles.",
  },
  roles: { path: "/v1/roles", description: "Roles (for role allocations)." },
  "contact-roles": { path: "/v1/contactroles", description: "Contact-person roles." },
  "communication-types": {
    path: "/v1/communicationtypes",
    description: "Communication types (for contacts).",
  },
};

const OPENAPI_URL =
  "https://api.severa.visma.com/psapublicrest/openapidocs/v1.0/doc.json";
const OPENAPI_CACHE_KEY = "severa:resource:openapi";
const OPENAPI_TTL_SECONDS = 7 * 24 * 60 * 60;
const REFERENCE_CACHE_PREFIX = "severa:resource:reference:";
const REFERENCE_TTL_SECONDS = 24 * 60 * 60;

export function registerResources(server: McpServer, env: Env, props: SessionProps): void {
  // 1) OpenAPI spec — the big one. Lets the LLM compose `severa_query`
  //    calls without guessing paths / params.
  server.registerResource(
    "severa-openapi",
    "severa://openapi.json",
    {
      title: "Severa v1 OpenAPI spec",
      description:
        "Full Severa REST API OpenAPI document. ~1.6 MB, cached 7 days. Read to discover endpoints and filters beyond the dedicated tools.",
      mimeType: "application/json",
    },
    async (uri) => {
      const cached = await env.CACHE_KV.get(OPENAPI_CACHE_KEY);
      let text = cached;
      if (!text) {
        const res = await fetch(OPENAPI_URL);
        if (!res.ok) {
          throw new Error(`Failed to fetch OpenAPI spec: ${res.status}`);
        }
        text = await res.text();
        await env.CACHE_KV.put(OPENAPI_CACHE_KEY, text, {
          expirationTtl: OPENAPI_TTL_SECONDS,
        });
      }
      return {
        contents: [{ uri: uri.toString(), mimeType: "application/json", text }],
      };
    },
  );

  // 2) Reference data template — one URI per Severa reference endpoint.
  server.registerResource(
    "severa-reference",
    new ResourceTemplate("severa://reference/{slug}", {
      list: async () => ({
        resources: Object.entries(REFERENCE_ENDPOINTS).map(([slug, meta]) => ({
          uri: `severa://reference/${slug}`,
          name: slug,
          description: meta.description,
          mimeType: "application/json",
        })),
      }),
      complete: {
        slug: async (partial: string) =>
          Object.keys(REFERENCE_ENDPOINTS).filter((s) => s.startsWith(partial)),
      },
    }),
    {
      title: "Severa reference data",
      description:
        "Small lookup tables (sales statuses, work types, business units, etc.). Cached 24h in Cloudflare KV. URIs: severa://reference/<slug>.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const slug = Array.isArray(variables.slug) ? variables.slug[0] : variables.slug;
      if (!slug || typeof slug !== "string") {
        throw new Error("Missing slug variable in reference URI");
      }
      const meta = REFERENCE_ENDPOINTS[slug];
      if (!meta) {
        throw new Error(
          `Unknown reference slug '${slug}'. Known: ${Object.keys(REFERENCE_ENDPOINTS).join(", ")}`,
        );
      }
      const cacheKey = `${REFERENCE_CACHE_PREFIX}${slug}`;
      const cached = await env.CACHE_KV.get(cacheKey);
      let text = cached;
      if (!text) {
        const data = await severaPaginate<unknown>(env, meta.path, { query: { rowCount: 100 } });
        text = JSON.stringify(data);
        await env.CACHE_KV.put(cacheKey, text, { expirationTtl: REFERENCE_TTL_SECONDS });
      }
      return {
        contents: [{ uri: uri.toString(), mimeType: "application/json", text }],
      };
    },
  );

  // 3) Current user — convenient context for "who am I" and mapping
  //    Genero email → Severa email → profile.
  server.registerResource(
    "severa-me",
    "severa://me",
    {
      title: "Current Severa user",
      description: "The signed-in user's Severa profile (GUID, email, name, business unit).",
      mimeType: "application/json",
    },
    async (uri) => {
      const guid = await requireSeveraUserGuid(env, props.email);
      const user = await severaFetch<UserOutputModel>(env, `/v1/users/${guid}`);
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify(user, null, 2),
          },
        ],
      };
    },
  );

  // 4) Organization summary — one-shot context for "about us". Needs
  //    organization:read scope (granted in commit f737f4b).
  server.registerResource(
    "severa-org-summary",
    "severa://org/summary",
    {
      title: "Organization details",
      description:
        "Severa organization details and settings (company info, defaults). Needs `organization:read` scope.",
      mimeType: "application/json",
    },
    async (uri) => {
      const details = await severaFetch<unknown>(env, "/v1/organizationdetails");
      const settings = await severaFetch<unknown>(env, "/v1/organizationsettings");
      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "application/json",
            text: JSON.stringify({ details, settings }, null, 2),
          },
        ],
      };
    },
  );
}
