import { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import request from 'supertest';
import { AGENT_TOOL_NAMES } from '@agentmatch/shared';
import { createMcpApp } from '../../mcp/src/app';
import { PrismaService } from '../src/common/prisma.service';
import { authed, createTestApp, onboardUser, registerUser, resetDb, TestUser } from './helpers';
import { REDIRECT, authorize, connectAgent, pkce, registerClient, tool } from './oauth-helpers';

describe('OAuth 2.1 + MCP server (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mcpServer: Server;
  let mcpUrl: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    await app.listen(0);
    const apiPort = (app.getHttpServer().address() as AddressInfo).port;
    const mcp = createMcpApp({
      apiUrl: 'http://localhost:4000',
      apiInternalUrl: `http://127.0.0.1:${apiPort}`,
      mcpUrl: 'http://localhost:4100',
      internalSecret: process.env.INTERNAL_API_SECRET!,
    });
    await new Promise<void>((resolve) => {
      mcpServer = mcp.listen(0, () => resolve());
    });
    mcpUrl = `http://127.0.0.1:${(mcpServer.address() as AddressInfo).port}/mcp`;
  });

  afterAll(async () => {
    await new Promise((r) => mcpServer.close(r));
    await app.close();
  });

  async function mcpClient(token: string) {
    const client = new Client({ name: 'test-client', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await client.connect(transport);
    return client;
  }

  async function verifiedUser(): Promise<TestUser> {
    const u = await registerUser(app);
    await onboardUser(app, u);
    return u;
  }

  describe('discovery', () => {
    it('publishes authorization server metadata', async () => {
      const r = await request(app.getHttpServer()).get('/.well-known/oauth-authorization-server').expect(200);
      expect(r.body.code_challenge_methods_supported).toEqual(['S256']);
      expect(r.body.registration_endpoint).toBe('http://localhost:4000/oauth/register');
    });

    it('MCP answers 401 with resource metadata, and serves it', async () => {
      const r = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toContain('resource_metadata="http://localhost:4100/.well-known/oauth-protected-resource/mcp"');
      const base = mcpUrl.replace(/\/mcp$/, '');
      const prm = (await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json()) as { resource: string; authorization_servers: string[] };
      expect(prm.resource).toBe('http://localhost:4100/mcp');
      expect(prm.authorization_servers).toEqual([expect.stringMatching(/^http:\/\/localhost:4000\/?$/)]);
    });
  });

  describe('authorization', () => {
    it('rejects bad registrations and requests', async () => {
      const server = app.getHttpServer();
      await request(server).post('/oauth/register').send({ client_name: 'x', redirect_uris: ['http://evil.example/cb'] }).expect(400);
      const clientId = await registerClient(app);
      const q = (extra: Record<string, string>) => new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, ...extra });
      // Public clients must use PKCE S256.
      await request(server).get(`/oauth/authorize?${q({})}`).expect(400);
      await request(server).get(`/oauth/authorize?${q({ code_challenge: 'abc', code_challenge_method: 'plain' })}`).expect(400);
      await request(server).get(`/oauth/authorize?${q({ redirect_uri: 'https://other.example/cb', code_challenge: 'abc', code_challenge_method: 'S256' })}`).expect(400);
    });

    it('requires 18+ verification before connecting an AI', async () => {
      const u = await registerUser(app);
      const clientId = await registerClient(app);
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256' });
      const r = await request(app.getHttpServer()).get(`/oauth/authorize?${q}`).expect(302);
      const id = new URL(r.headers.location).searchParams.get('request')!;
      const d = await authed(app, u).post(`/oauth/requests/${id}/decision`).send({ approve: true }).expect(403);
      expect(d.body.error).toBe('age_verification_required');
    });

    it('verifies PKCE, prevents code replay and rotates refresh tokens', async () => {
      const u = await verifiedUser();
      const clientId = await registerClient(app);
      const { verifier, challenge } = pkce();
      const code = await authorize(app, u, clientId, challenge);
      const server = app.getHttpServer();
      const base = { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: REDIRECT };
      const bad = await request(server).post('/oauth/token').type('form').send({ ...base, code_verifier: 'wrong' }).expect(400);
      expect(bad.body.error).toBe('invalid_grant');
      const ok = await request(server).post('/oauth/token').type('form').send({ ...base, code_verifier: verifier }).expect(200);
      expect(ok.body.token_type).toBe('Bearer');
      expect(ok.headers['cache-control']).toBe('no-store');
      await request(server).post('/oauth/token').type('form').send({ ...base, code_verifier: verifier }).expect(400);
      // Replay revoked the tokens issued from that code.
      await tool(app, ok.body.access_token, 'get_profile_schema').expect(401);

      const again = await connectAgent(app, u);
      const r1 = await request(server).post('/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: again.refreshToken, client_id: again.clientId }).expect(200);
      await tool(app, r1.body.access_token, 'get_profile_schema').expect(200);
      await request(server).post('/oauth/token').type('form').send({ grant_type: 'refresh_token', refresh_token: again.refreshToken, client_id: again.clientId }).expect(400);
      // Refreshing reuses the connection instead of creating a new one.
      expect(await prisma.agentConnection.count({ where: { userId: u.id, clientId: again.clientId } })).toBe(1);
    });

    it('denied consent redirects with access_denied', async () => {
      const u = await verifiedUser();
      const clientId = await registerClient(app);
      const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256', state: 's1' });
      const r = await request(app.getHttpServer()).get(`/oauth/authorize?${q}`).expect(302);
      const id = new URL(r.headers.location).searchParams.get('request')!;
      const info = await authed(app, u).get(`/oauth/requests/${id}`).expect(200);
      expect(info.body.clientName).toBe('Claude');
      const d = await authed(app, u).post(`/oauth/requests/${id}/decision`).send({ approve: false }).expect(200);
      expect(d.body.redirectUrl).toBe(`${REDIRECT}?state=s1&error=access_denied`);
    });
  });

  describe('MCP tools', () => {
    it('lists the eight tools and returns the profile schema', async () => {
      const u = await verifiedUser();
      const { accessToken } = await connectAgent(app, u);
      const client = await mcpClient(accessToken);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
      expect(client.getInstructions()).toContain('never share or ask for contact details');

      const r = await client.callTool({ name: 'get_profile_schema', arguments: {} });
      const body = JSON.parse((r.content as { text: string }[])[0].text);
      expect(body.profile.missingRequired).toContain('birthDate');
      const keys = body.fields.map((f: { key: string }) => f.key);
      expect(keys).toContain('relationshipType');
      expect(keys).not.toContain('faith'); // no sensitive-data consent
      expect(body.fields.find((f: { key: string }) => f.key === 'smoking').schema.enum).toEqual(['never', 'socially', 'regularly']);
      await client.close();
    });

    it('update_profile creates a draft, never a direct change, and is logged', async () => {
      const u = await verifiedUser();
      const { accessToken } = await connectAgent(app, u);
      const client = await mcpClient(accessToken);
      const r = await client.callTool({
        name: 'update_profile',
        arguments: { changes: { lifestyle: { smoking: 'never', pets: 'cat' } }, note: 'From our chat' },
      });
      expect(r.isError).toBeFalsy();
      const body = JSON.parse((r.content as { text: string }[])[0].text);
      expect(body.status).toBe('PENDING_HUMAN_APPROVAL');

      const profile = await authed(app, u).get('/profile').expect(200);
      expect(profile.body.data.lifestyle).toBeUndefined();
      expect(profile.body.drafts).toHaveLength(1);
      expect(profile.body.drafts[0].source).toBe('AGENT_MCP');

      const bad = await client.callTool({ name: 'update_profile', arguments: { changes: { description: { aiDescription: 'mail me: a@b.com' } } } });
      expect(bad.isError).toBe(true);
      const invalid = await client.callTool({ name: 'update_profile', arguments: { changes: { contacts: { phone: '1' } } } });
      expect(invalid.isError).toBe(true);

      const log = await authed(app, u).get('/agent/log').expect(200);
      expect(log.body.map((l: { tool: string; status: string }) => `${l.tool}:${l.status}`)).toEqual(
        expect.arrayContaining(['update_profile:ok', 'update_profile:error']),
      );
      expect(log.body[0].agent).toContain('Claude (MCP)');
      await client.close();
    });

    it('stops working immediately when AI is disabled or the connection revoked', async () => {
      const u = await verifiedUser();
      const { accessToken } = await connectAgent(app, u);
      await tool(app, accessToken, 'get_profile_schema').expect(200);
      await prisma.user.update({ where: { id: u.id }, data: { aiEnabled: false } });
      await tool(app, accessToken, 'get_profile_schema').expect(403);
      const r = await fetch(mcpUrl, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      expect(r.status).toBe(401);
      await prisma.user.update({ where: { id: u.id }, data: { aiEnabled: true } });

      const conns = await authed(app, u).get('/connections').expect(200);
      await authed(app, u).delete(`/connections/${conns.body[0].id}`).expect(200);
      await tool(app, accessToken, 'get_profile_schema').expect(401);
    });
  });

  describe('Custom GPT (OpenAPI Actions)', () => {
    it('serves an OpenAPI spec with one operation per tool', async () => {
      const r = await request(app.getHttpServer()).get('/agent/v1/openapi.json').expect(200);
      const ops = Object.values(r.body.paths as Record<string, { post: { operationId: string } }>).map((p) => p.post.operationId);
      expect(ops.sort()).toEqual([...AGENT_TOOL_NAMES].sort());
      expect(r.body.components.securitySchemes.oauth.flows.authorizationCode.tokenUrl).toBe('http://localhost:4000/oauth/token');
    });

    it('authorizes the pre-registered GPT client with its secret', async () => {
      const u = await verifiedUser();
      const redirect = 'https://chatgpt.com/aip/g-abc123/oauth/callback';
      const q = new URLSearchParams({ response_type: 'code', client_id: 'agentmatch-custom-gpt', redirect_uri: redirect, state: 'st' });
      const server = app.getHttpServer();
      await request(server).get(`/oauth/authorize?${new URLSearchParams({ ...Object.fromEntries(q), redirect_uri: 'https://evil.example/cb' })}`).expect(400);
      const r = await request(server).get(`/oauth/authorize?${q}`).expect(302);
      const id = new URL(r.headers.location).searchParams.get('request')!;
      const d = await authed(app, u).post(`/oauth/requests/${id}/decision`).send({ approve: true }).expect(200);
      const code = new URL(d.body.redirectUrl).searchParams.get('code')!;
      const form = { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: 'agentmatch-custom-gpt' };
      await request(server).post('/oauth/token').type('form').send({ ...form, client_secret: 'wrong' }).expect(401);
      const t = await request(server).post('/oauth/token').type('form').send({ ...form, client_secret: 'gpt-secret' }).expect(200);
      await tool(app, t.body.access_token, 'get_profile_schema').expect(200);
      const conn = await prisma.agentConnection.findFirst({ where: { userId: u.id } });
      expect(conn?.type).toBe('CUSTOM_GPT');
    });
  });
});
