import { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { TestUser, authed } from './helpers';

export const REDIRECT = 'http://localhost:9999/callback';

export function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export async function registerClient(app: INestApplication, name = 'Claude') {
  const res = await request(app.getHttpServer()).post('/oauth/register').send({ client_name: name, redirect_uris: [REDIRECT] }).expect(201);
  return res.body.client_id as string;
}

/** Runs authorize -> consent -> returns the authorization code. */
export async function authorize(app: INestApplication, user: TestUser, clientId: string, challenge: string, redirect = REDIRECT) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
  });
  const r = await request(app.getHttpServer()).get(`/oauth/authorize?${q}`).expect(302);
  const requestId = new URL(r.headers.location).searchParams.get('request')!;
  const d = await authed(app, user).post(`/oauth/requests/${requestId}/decision`).send({ approve: true }).expect(200);
  const cb = new URL(d.body.redirectUrl);
  expect(cb.searchParams.get('state')).toBe('xyz');
  return cb.searchParams.get('code')!;
}

export async function connectAgent(app: INestApplication, user: TestUser) {
  const clientId = await registerClient(app);
  const { verifier, challenge } = pkce();
  const code = await authorize(app, user, clientId, challenge);
  const t = await request(app.getHttpServer())
    .post('/oauth/token')
    .type('form')
    .send({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT })
    .expect(200);
  return { clientId, accessToken: t.body.access_token as string, refreshToken: t.body.refresh_token as string };
}

/** Calls an agent tool directly on the API (as the MCP server would). */
export function tool(app: INestApplication, token: string, name: string, args: unknown = {}) {
  return request(app.getHttpServer()).post(`/agent/v1/tools/${name}`).set('Authorization', `Bearer ${token}`).send(args as object);
}
