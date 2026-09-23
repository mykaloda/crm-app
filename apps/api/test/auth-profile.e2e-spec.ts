import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { ProfileService } from '../src/profile/profile.service';
import { authed, createTestApp, fullProfile, onboardUser, registerUser, resetDb } from './helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

describe('Auth, onboarding and profile (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
  });
  afterAll(async () => app.close());

  describe('email auth', () => {
    it('registers, rejects duplicates and bad passwords, logs in', async () => {
      const server = app.getHttpServer();
      await request(server).post('/auth/register').send({ email: 'Ann@Test.local', password: 'correct-horse-9' }).expect(201);
      await request(server).post('/auth/register').send({ email: 'ann@test.local', password: 'correct-horse-9' }).expect(409);
      await request(server).post('/auth/register').send({ email: 'bad', password: 'x' }).expect(400);
      await request(server).post('/auth/login').send({ email: 'ann@test.local', password: 'wrong-password' }).expect(401);
      const ok = await request(server).post('/auth/login').send({ email: 'ann@test.local', password: 'correct-horse-9' }).expect(200);
      expect(ok.body.accessToken).toBeTruthy();
      expect(ok.headers['set-cookie'].join(';')).toMatch(/am_access=.*HttpOnly/);
    });

    it('rotates refresh tokens and detects reuse', async () => {
      const agent = request.agent(app.getHttpServer());
      const reg = await agent.post('/auth/register').send({ email: 'rot@test.local', password: 'correct-horse-9' }).expect(201);
      const cookie = reg.headers['set-cookie'].find((c: string) => c.startsWith('am_refresh='))!;
      const oldRefresh = cookie.split(';')[0].split('=')[1];
      await agent.post('/auth/refresh').expect(200);
      // Replaying the old token revokes the whole family.
      await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: oldRefresh }).expect(401);
      await agent.post('/auth/refresh').expect(401);
    });

    it('requires auth on private endpoints', async () => {
      await request(app.getHttpServer()).get('/me').expect(401);
      await request(app.getHttpServer()).get('/health').expect(200);
    });
  });

  describe('social login (mock provider)', () => {
    it('completes the google flow and creates a user', async () => {
      const agent = request.agent(app.getHttpServer());
      const start = await agent.get('/auth/google/start').expect(302);
      const authorizeUrl = new URL(start.headers.location);
      expect(authorizeUrl.pathname).toBe('/auth/mock/google/authorize');
      const state = authorizeUrl.searchParams.get('state')!;
      const submit = await agent.post('/auth/mock/google/authorize').type('form').send({ email: 'g@test.local', state }).expect(302);
      const cb = new URL(submit.headers.location);
      const done = await agent.get(`${cb.pathname}${cb.search}`).expect(302);
      expect(done.headers.location).toBe('http://localhost:3000/onboarding');
      const me = await agent.get('/me').expect(200);
      expect(me.body.email).toBe('g@test.local');
      expect(await prisma.authIdentity.count({ where: { provider: 'google', userId: me.body.id } })).toBe(1);
    });

    it('rejects a forged state', async () => {
      const agent = request.agent(app.getHttpServer());
      await agent.get('/auth/google/start').expect(302);
      const code = Buffer.from('evil@test.local').toString('base64url');
      await agent.get(`/auth/google/callback?code=${code}&state=forged`).expect(400);
    });
  });

  describe('onboarding', () => {
    it('walks consent -> verify -> connect', async () => {
      const u = await registerUser(app);
      const a = authed(app, u);
      expect((await a.get('/me')).body.onboarding.nextStep).toBe('consent');
      await onboardUser(app, u);
      const me = await a.get('/me').expect(200);
      expect(me.body.ageVerificationStatus).toBe('VERIFIED');
      expect(me.body.consents).toEqual(expect.arrayContaining(['TERMS', 'PRIVACY', 'AI_PROCESSING']));
      expect(me.body.consents).not.toContain('SENSITIVE_DATA');
      expect(me.body.onboarding.nextStep).toBe('connect');
    });

    it('rejects minors at verification', async () => {
      const u = await registerUser(app);
      const a = authed(app, u);
      const s = await a.post('/verification/age/start').expect(200);
      const r = await a.post('/verification/age/mock/complete').send({ sessionId: s.body.sessionId, birthDate: '2015-01-01' }).expect(200);
      expect(r.body.status).toBe('REJECTED');
    });

    it('does not let one user complete another user\'s verification', async () => {
      const u1 = await registerUser(app);
      const u2 = await registerUser(app);
      const s = await authed(app, u1).post('/verification/age/start').expect(200);
      await authed(app, u2).post('/verification/age/mock/complete').send({ sessionId: s.body.sessionId, birthDate: '1990-01-01' }).expect(404);
    });
  });

  describe('profile', () => {
    it('saves a full profile, encrypts values and computes the embedding', async () => {
      const u = await registerUser(app);
      await onboardUser(app, u);
      const res = await authed(app, u).put('/profile').send(fullProfile()).expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.completeness).toBe(100);
      expect(res.body.data.values).toEqual({ family: 5, career: 3, money: 3 });

      const raw = await prisma.$queryRaw<{ valuesEnc: string; has_emb: boolean }[]>`
        SELECT "valuesEnc", embedding IS NOT NULL AS has_emb FROM "Profile" WHERE "userId" = ${u.id}`;
      expect(raw[0].valuesEnc.startsWith('v1.')).toBe(true);
      expect(raw[0].valuesEnc).not.toContain('family');
      expect(raw[0].has_emb).toBe(true);
    });

    it('validates age, ranges and contact details in text', async () => {
      const u = await registerUser(app);
      const a = authed(app, u);
      await a.put('/profile').send({ basic: { birthDate: '2012-01-01' } }).expect(400);
      await a.put('/profile').send({ basic: { ageMin: 40, ageMax: 30 } }).expect(400);
      await a.put('/profile').send({ description: { aiDescription: 'Text me on whatsapp +49 151 2345 6789' } }).expect(400);
      await a.put('/profile').send({ lifestyle: { smoking: 'sometimes' } }).expect(400);
    });

    it('requires separate consent for sensitive fields', async () => {
      const u = await registerUser(app);
      const a = authed(app, u);
      await a.put('/profile').send({ values: { faith: 'christian' } }).expect(403);
      await a.post('/me/consents').send({ sensitiveData: true }).expect(200);
      await a.put('/profile').send({ values: { faith: 'christian', family: 4 } }).expect(200);
      // Withdrawing consent purges the sensitive fields.
      await a.post('/me/consents').send({ sensitiveData: false }).expect(200);
      const p = await a.get('/profile').expect(200);
      expect(p.body.data.values).toEqual({ family: 4 });
    });

    it('clamps visibility to allowed ranges', async () => {
      const u = await registerUser(app);
      const res = await authed(app, u).put('/profile/visibility').send({ lat: 'people', smoking: 'people', gender: 'hidden' }).expect(200);
      expect(res.body.lat).toBe('algorithm_only');
      expect(res.body.smoking).toBe('people');
      expect(res.body.gender).toBe('algorithm_only');
    });

    it('keeps AI changes as drafts until approved', async () => {
      const u = await registerUser(app);
      const a = authed(app, u);
      const profiles = app.get(ProfileService);
      const d1 = await profiles.createDraft(u.id, { lifestyle: { smoking: 'never' }, values: { faith: 'jewish' } }, 'AGENT_MCP', { note: 'from interview' });
      expect(d1.status).toBe('PENDING_HUMAN_APPROVAL');
      expect(d1.droppedFields).toEqual(['faith']);
      const before = await a.get('/profile').expect(200);
      expect(before.body.data.lifestyle).toBeUndefined();
      expect(before.body.drafts).toHaveLength(1);
      expect(before.body.drafts[0].patch).toEqual({ lifestyle: { smoking: 'never' }, values: {} });

      await a.post(`/profile/drafts/${d1.draftId}/approve`).send({}).expect(200);
      const after = await a.get('/profile').expect(200);
      expect(after.body.data.lifestyle).toEqual({ smoking: 'never' });
      expect(after.body.drafts).toHaveLength(0);

      const d2 = await profiles.createDraft(u.id, { lifestyle: { alcohol: 'regularly' } }, 'AGENT_GPT');
      await a.post(`/profile/drafts/${d2.draftId}/reject`).expect(200);
      await a.post(`/profile/drafts/${d2.draftId}/approve`).send({}).expect(404);

      // The human may edit a draft before approving it.
      const d3 = await profiles.createDraft(u.id, { lifestyle: { alcohol: 'regularly' } }, 'AGENT_BUILTIN');
      await a.post(`/profile/drafts/${d3.draftId}/approve`).send({ patch: { lifestyle: { alcohol: 'socially' } } }).expect(200);
      expect((await a.get('/profile')).body.data.lifestyle).toEqual({ smoking: 'never', alcohol: 'socially' });
    });

    it('rejects drafts with contact details', async () => {
      const u = await registerUser(app);
      await expect(
        app.get(ProfileService).createDraft(u.id, { interests: { interestsText: 'find me at insta @anna.k' } }, 'AGENT_MCP'),
      ).rejects.toThrow();
    });

    it('stores photos encrypted and hides them from other users', async () => {
      const owner = await registerUser(app);
      const other = await registerUser(app);
      const up = await authed(app, owner).post('/profile/photos').attach('file', PNG, 'a.png').expect(201);
      const got = await authed(app, owner).get(`/photos/${up.body.id}`).expect(200);
      expect(Buffer.compare(got.body as Buffer, PNG)).toBe(0);
      await authed(app, other).get(`/photos/${up.body.id}`).expect(403);
      await authed(app, owner).post('/profile/photos').attach('file', Buffer.from('not an image'), 'x.png').expect(400);
    });
  });
});
