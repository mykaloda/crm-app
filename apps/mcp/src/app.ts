import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, AGENT_TOOL_NAMES, AgentToolName } from '@agentmatch/shared';

export interface McpAppOptions {
  /** Public API URL (OAuth issuer). */
  apiUrl: string;
  /** URL the MCP server uses to reach the API. */
  apiInternalUrl: string;
  /** Public URL of this MCP server. */
  mcpUrl: string;
  internalSecret: string;
  fetchImpl?: typeof fetch;
}

type Fetch = typeof fetch;

/** Validates bearer tokens by asking the API (the authorization server). */
export function apiTokenVerifier(o: McpAppOptions): OAuthTokenVerifier {
  const f: Fetch = o.fetchImpl ?? fetch;
  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const res = await f(`${o.apiInternalUrl}/oauth/introspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': o.internalSecret },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) throw new InvalidTokenError('Token introspection failed');
      const body = (await res.json()) as { active: boolean; client_id?: string; scope?: string; exp?: number; sub?: string };
      if (!body.active) throw new InvalidTokenError('Token is not active');
      return {
        token,
        clientId: body.client_id ?? 'unknown',
        scopes: (body.scope ?? '').split(' ').filter(Boolean),
        expiresAt: body.exp,
        extra: { userId: body.sub },
      };
    },
  };
}

/** Forward one tool call to the API; every rule (drafts, filters, logging, limits) is enforced there. */
export async function callApiTool(o: McpAppOptions, token: string, tool: AgentToolName, args: unknown): Promise<CallToolResult> {
  const f: Fetch = o.fetchImpl ?? fetch;
  const res = await f(`${o.apiInternalUrl}/agent/v1/tools/${tool}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(args ?? {}),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const b = body as { error?: string; message?: string | string[]; issues?: unknown; categories?: unknown };
    const message = {
      error: b?.error ?? `http_${res.status}`,
      message: Array.isArray(b?.message) ? b.message.join('; ') : b?.message,
      issues: b?.issues,
      categories: b?.categories,
    };
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(message) }] };
  }
  return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
}

export function buildMcpServer(o: McpAppOptions, token: string): McpServer {
  const server = new McpServer(
    { name: 'agentmatch', title: 'AgentMatch', version: '1.0.0' },
    { instructions: AGENT_INSTRUCTIONS, capabilities: { tools: {} } },
  );
  for (const name of AGENT_TOOL_NAMES) {
    const def = AGENT_TOOLS[name];
    server.registerTool(
      name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input.shape,
        annotations: { readOnlyHint: def.readOnly, destructiveHint: false, openWorldHint: false },
      },
      async (args: unknown) => callApiTool(o, token, name, args),
    );
  }
  return server;
}

export function createMcpApp(o: McpAppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin: true,
      exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version'],
    }),
  );
  app.use(express.json({ limit: '256kb' }));

  const resourceUrl = new URL(`${o.mcpUrl}/mcp`);
  const oauthMetadata = {
    issuer: o.apiUrl,
    authorization_endpoint: `${o.apiUrl}/oauth/authorize`,
    token_endpoint: `${o.apiUrl}/oauth/token`,
    registration_endpoint: `${o.apiUrl}/oauth/register`,
    revocation_endpoint: `${o.apiUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['profile', 'agents', 'matches'],
  };
  // RFC 9728 protected resource metadata (path-suffixed and root variants).
  app.use(mcpAuthMetadataRouter({ oauthMetadata, resourceServerUrl: resourceUrl, resourceName: 'AgentMatch', scopesSupported: oauthMetadata.scopes_supported }));
  app.get('/.well-known/oauth-protected-resource', (_req, res) => {
    res.json({
      resource: resourceUrl.href,
      authorization_servers: [o.apiUrl],
      scopes_supported: oauthMetadata.scopes_supported,
      bearer_methods_supported: ['header'],
      resource_name: 'AgentMatch',
    });
  });
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  const auth = requireBearerAuth({
    verifier: apiTokenVerifier(o),
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
  });

  // Stateless Streamable HTTP: a fresh server + transport per request, bound to the caller's token.
  app.post('/mcp', auth, async (req: Request, res: Response) => {
    const server = buildMcpServer(o, req.auth!.token);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
      }
      console.error('MCP request failed', e);
    }
  });
  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server)' }, id: null });
  };
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
  return app;
}
