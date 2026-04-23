import { describe, it, expect, beforeEach } from "vitest";
import customersActive from "../../__fixtures__/severa/customers.active.json";
import { callTool, listTools, mockSeveraFetch } from "../../test/harness";
import { registerQueryTools } from "./query";

describe("severa_query", () => {
  beforeEach(() => {
    mockSeveraFetch({
      routes: [
        { path: "/v1/customers", query: { isActive: "true" }, response: customersActive },
      ],
    });
  });

  it("proxies a GET to /v1/customers with given query", async () => {
    const { text } = await callTool(
      "severa_query",
      { path: "/v1/customers", query: { isActive: true } },
      [registerQueryTools],
    );
    expect(text).toContain("Acme Oy");
    expect(text).toContain("Beta Industries");
    expect(text).toContain("3 row(s)");
  });

  it("rejects paths outside /v1/", async () => {
    const { text, raw } = await callTool(
      "severa_query",
      { path: "/v2/foo" },
      [registerQueryTools],
    );
    // MCP returns an error block with the zod validation message
    const isError = (raw as { isError?: boolean }).isError === true;
    expect(isError || /must start with \/v1\//i.test(text)).toBe(true);
  });
});

describe("severa_query registration", () => {
  it("registers severa_query with non-empty description", async () => {
    const tools = await listTools([registerQueryTools]);
    expect(tools.map((t) => t.name)).toEqual(["severa_query"]);
    expect(tools[0]!.description!.length).toBeGreaterThan(50);
  });
});
