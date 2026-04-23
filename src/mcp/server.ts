import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import type { SessionProps } from "../auth/session";
import { registerLookupTools } from "./tools/lookup";
import { registerHoursTools } from "./tools/hours";
import { registerCaseTools } from "./tools/cases";
import { registerBillingForecastTools } from "./tools/billing-forecast";
import { registerQueryTools } from "./tools/query";

export class SeveraMcpAgent extends McpAgent<Env, Record<string, never>, SessionProps> {
  server = new McpServer({ name: "severa-mcp", version: "0.1.0" });

  async init(): Promise<void> {
    const enableWrites = this.env.ENABLE_WRITE_TOOLS === "true";
    registerLookupTools(this.server, this.env, this.props);
    registerCaseTools(this.server, this.env, this.props);
    registerBillingForecastTools(this.server, this.env);
    registerHoursTools(this.server, this.env, this.props, { enableWrites });
    registerQueryTools(this.server, this.env);
  }
}
