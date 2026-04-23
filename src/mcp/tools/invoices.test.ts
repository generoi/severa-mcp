import { describe, it, expect, beforeEach } from "vitest";
import invoices from "../../__fixtures__/severa/invoices.q1-2026.json";
import { callTool, listTools, mockSeveraFetch } from "../../test/harness";
import { registerInvoiceTools } from "./invoices";

describe("severa_list_invoices", () => {
  let calls: ReturnType<typeof mockSeveraFetch>["calls"];

  beforeEach(() => {
    ({ calls } = mockSeveraFetch({
      routes: [{ path: "/v1/invoices", response: invoices }],
    }));
  });

  it("lists invoices and totals excl tax", async () => {
    const { text } = await callTool("severa_list_invoices", {}, [registerInvoiceTools]);
    expect(text).toMatch(/2 invoice\(s\)/);
    expect(text).toMatch(/total\s+20\s+500/);
    expect(text).toContain("Acme Oy");
    expect(text).toContain("Beta Industries");
  });

  it("passes startDate/endDate to the API verbatim", async () => {
    await callTool(
      "severa_list_invoices",
      { startDate: "2026-01-01", endDate: "2026-03-31" },
      [registerInvoiceTools],
    );
    const inv = calls.find((c) => c.url.includes("/v1/invoices"));
    expect(inv?.url).toContain("startDate=2026-01-01");
    expect(inv?.url).toContain("endDate=2026-03-31");
  });

  it("applies client-side statusNameContains", async () => {
    const { text } = await callTool(
      "severa_list_invoices",
      { statusNameContains: "Paid" },
      [registerInvoiceTools],
    );
    expect(text).toContain("Acme Oy");
    expect(text).not.toContain("Beta Industries");
  });

  it("merges singular customerGuid into customerGuids", async () => {
    await callTool(
      "severa_list_invoices",
      { customerGuid: "11111111-1111-1111-1111-111111111111" },
      [registerInvoiceTools],
    );
    const inv = calls.find((c) => c.url.includes("/v1/invoices"));
    expect(inv?.url).toContain("customerGuids=11111111-1111-1111-1111-111111111111");
  });
});

describe("invoice tool registration", () => {
  it("advertises both invoice tools with descriptions", async () => {
    const tools = await listTools([registerInvoiceTools]);
    expect(tools.map((t) => t.name).sort()).toEqual([
      "severa_list_invoice_rows",
      "severa_list_invoices",
    ]);
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.description!.length).toBeGreaterThanOrEqual(40);
    }
  });
});
