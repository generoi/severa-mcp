import { describe, it, expect, beforeEach } from "vitest";
import { mockSeveraFetch, withMcpServer } from "../../test/harness";
import { registerResources } from "./index";

async function listResources(): Promise<{ name: string; uri: string }[]> {
  const handle = await withMcpServer([registerResources]);
  try {
    const result = await handle.client.listResources();
    return result.resources.map((r) => ({ name: r.name, uri: r.uri }));
  } finally {
    await handle.close();
  }
}

async function readResource(uri: string): Promise<string> {
  const handle = await withMcpServer([registerResources]);
  try {
    const result = await handle.client.readResource({ uri });
    const text = result.contents
      .map((c) => ("text" in c && typeof c.text === "string" ? c.text : ""))
      .join("");
    return text;
  } finally {
    await handle.close();
  }
}

describe("MCP resources", () => {
  describe("severa://openapi.json", () => {
    beforeEach(() => {
      mockSeveraFetch({
        routes: [
          {
            method: "GET",
            path: "/v1.0/doc.json",
            response: { openapi: "3.0.0", info: { title: "Severa" } },
          },
        ],
      });
    });

    it("fetches and caches the OpenAPI spec", async () => {
      const text = await readResource("severa://openapi.json");
      expect(text).toContain('"openapi"');
      expect(text).toContain('"Severa"');
    });
  });

  describe("severa://reference/{slug}", () => {
    beforeEach(() => {
      mockSeveraFetch({
        routes: [
          {
            path: "/v1/salesstatustypes",
            response: [
              { guid: "abc", name: "Proposal / NB", salesState: "InProgress" },
              { guid: "def", name: "Order / NB", salesState: "Won" },
            ],
          },
          {
            path: "/v1/worktypes",
            response: [{ guid: "wt-1", name: "Project Management" }],
          },
        ],
      });
    });

    it("reads sales-status-types", async () => {
      const text = await readResource("severa://reference/sales-status-types");
      expect(text).toContain("Proposal / NB");
      expect(text).toContain("Order / NB");
    });

    it("reads work-types", async () => {
      const text = await readResource("severa://reference/work-types");
      expect(text).toContain("Project Management");
    });

    it("rejects unknown slugs", async () => {
      await expect(readResource("severa://reference/nonexistent")).rejects.toThrow(
        /Unknown reference slug/,
      );
    });
  });

  describe("severa://me", () => {
    beforeEach(() => {
      mockSeveraFetch({
        routes: [
          {
            path: "/v1/users",
            query: { email: "test@genero.fi" },
            response: [
              {
                guid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                firstName: "Test",
                lastName: "User",
                email: "test@genero.fi",
              },
            ],
          },
          {
            path: "/v1/users/cccccccc-cccc-cccc-cccc-cccccccccccc",
            response: {
              guid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
              firstName: "Test",
              lastName: "User",
              email: "test@genero.fi",
              title: "Developer",
            },
          },
        ],
      });
    });

    it("returns the current user's profile JSON", async () => {
      const text = await readResource("severa://me");
      expect(text).toContain("Developer");
      expect(text).toContain("test@genero.fi");
    });
  });

  describe("severa://org/summary", () => {
    beforeEach(() => {
      mockSeveraFetch({
        routes: [
          { path: "/v1/organizationdetails", response: { name: "Genero Oy" } },
          { path: "/v1/organizationsettings", response: { defaultCurrency: "EUR" } },
        ],
      });
    });

    it("returns details + settings bundle", async () => {
      const text = await readResource("severa://org/summary");
      expect(text).toContain("Genero Oy");
      expect(text).toContain("EUR");
    });
  });

  describe("resources/list", () => {
    it("advertises openapi, me, org-summary and a reference template", async () => {
      const resources = await listResources();
      const names = resources.map((r) => r.name).filter((n): n is string => Boolean(n)).sort();
      // The reference template contributes one entry per known slug via its
      // list callback, plus the three static resources are named.
      expect(names).toContain("severa-openapi");
      expect(names).toContain("severa-me");
      expect(names).toContain("severa-org-summary");
      expect(names).toContain("sales-status-types");
      expect(names).toContain("work-types");
      expect(names).toContain("business-units");
    });
  });
});
