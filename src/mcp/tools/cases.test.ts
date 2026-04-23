import { describe, it, expect, beforeEach } from "vitest";
import salesCasesOpen from "../../__fixtures__/severa/salescases.open.json";
import { callTool, listTools, mockSeveraFetch } from "../../test/harness";
import { registerCaseTools } from "./cases";

describe("severa_list_sales_cases", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [{ path: "/v1/salescases", response: salesCasesOpen }],
    });
  });

  it("returns all open cases when no filters given", async () => {
    const { text } = await callTool("severa_list_sales_cases", {}, [registerCaseTools]);
    expect(text).toMatch(/2 case\(s\)/);
    expect(text).toContain("Acme Q3 proposal");
    expect(text).toContain("Beta expansion");
  });

  it("filters NB cases via statusNameContains (client-side)", async () => {
    const { text } = await callTool(
      "severa_list_sales_cases",
      { statusNameContains: "NB" },
      [registerCaseTools],
    );
    expect(text).toContain("Acme Q3 proposal");
    expect(text).not.toContain("Beta expansion");
  });

  it("filters by nameContains across case/customer/number", async () => {
    const { text } = await callTool(
      "severa_list_sales_cases",
      { nameContains: "Beta" },
      [registerCaseTools],
    );
    expect(text).toContain("Beta expansion");
    expect(text).not.toContain("Acme Q3 proposal");
  });
});

describe("severa_pipeline_summary", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [
        {
          path: "/v1/salescases",
          query: { isClosed: "false" },
          response: salesCasesOpen,
        },
      ],
    });
  });

  it("groups by status and weights by probability", async () => {
    const { text } = await callTool("severa_pipeline_summary", {}, [registerCaseTools]);
    // raw = 40 000 + 25 000 = 65 000
    // weighted = 40 000 * 0.5 + 25 000 * 0.7 = 20 000 + 17 500 = 37 500
    expect(text).toMatch(/raw\s+65\s+000/);
    expect(text).toMatch(/weighted\s+37\s+500/);
    expect(text).toContain("Proposal presentation / NB");
    expect(text).toContain("Proposal presentation / EB");
  });
});

describe("case tool registration", () => {
  it("advertises expected case tools with descriptions", async () => {
    const tools = await listTools([registerCaseTools]);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "severa_get_case",
      "severa_list_sales_cases",
      "severa_pipeline_summary",
    ]);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
    }
  });
});
