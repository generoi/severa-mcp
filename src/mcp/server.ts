import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../env";
import type { SessionProps } from "../auth/session";
import { registerLookupTools } from "./tools/lookup";
import { registerHoursTools } from "./tools/hours";
import { registerCaseTools } from "./tools/cases";
import { registerBillingForecastTools } from "./tools/billing-forecast";
import { registerInvoiceTools } from "./tools/invoices";
import { registerProposalTools } from "./tools/proposals";
import { registerActivityTools } from "./tools/activities";
import { registerUserTools } from "./tools/users";
import { registerContactTools } from "./tools/contacts";
import { registerProductTools } from "./tools/products";
import { registerPhaseTools } from "./tools/phases";
import { registerResourceAllocationTools } from "./tools/resource-allocations";
import { registerFeeTools } from "./tools/fees";
import { registerTravelTools } from "./tools/travels";
import { registerOvertimeTools } from "./tools/overtimes";
import { registerHolidayTools } from "./tools/holidays";
import { registerRoleTools } from "./tools/roles";
import { registerPhaseMemberTools } from "./tools/phase-members";
import { registerRootPhaseTools } from "./tools/root-phases";
import { registerContactCommunicationTools } from "./tools/contact-communications";
import { registerQueryTools } from "./tools/query";
import { registerResources } from "./resources";

export class SeveraMcpAgent extends McpAgent<Env, Record<string, never>, SessionProps> {
  server = new McpServer({ name: "severa-mcp", version: "0.1.0" });

  async init(): Promise<void> {
    const enableWrites = this.env.ENABLE_WRITE_TOOLS === "true";
    registerLookupTools(this.server, this.env, this.props);
    registerCaseTools(this.server, this.env, this.props);
    registerBillingForecastTools(this.server, this.env);
    registerHoursTools(this.server, this.env, this.props, { enableWrites });
    registerInvoiceTools(this.server, this.env);
    registerProposalTools(this.server, this.env);
    registerActivityTools(this.server, this.env, this.props);
    registerUserTools(this.server, this.env);
    registerContactTools(this.server, this.env);
    registerProductTools(this.server, this.env);
    registerPhaseTools(this.server, this.env);
    registerResourceAllocationTools(this.server, this.env);
    registerFeeTools(this.server, this.env);
    registerTravelTools(this.server, this.env);
    registerOvertimeTools(this.server, this.env);
    registerHolidayTools(this.server, this.env);
    registerRoleTools(this.server, this.env);
    registerPhaseMemberTools(this.server, this.env);
    registerRootPhaseTools(this.server, this.env);
    registerContactCommunicationTools(this.server, this.env);
    registerQueryTools(this.server, this.env);
    registerResources(this.server, this.env, this.props);
  }
}
