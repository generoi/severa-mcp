import OAuthProvider from "@cloudflare/workers-oauth-provider";
import type { Env } from "./env";
import { SeveraMcpAgent } from "./mcp/server";
import { handleOAuthRequest } from "./auth/google-idp";

export { SeveraMcpAgent };

const defaultHandler: ExportedHandler = {
  fetch: (request, env) => handleOAuthRequest(request, env as Env),
};

export default new OAuthProvider({
  apiHandlers: {
    "/sse": SeveraMcpAgent.serveSSE("/sse"),
    "/mcp": SeveraMcpAgent.serve("/mcp"),
  },
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
