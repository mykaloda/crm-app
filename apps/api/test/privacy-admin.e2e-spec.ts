import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/common/prisma.service';
import { BuiltinAgentService } from '../src/negotiation/builtin-agent.service';
import { PHOTO_STORAGE, PhotoStorage } from '../src/profile/photo-storage';
import { agentMatchedPair, authed, createTestApp, onboardUser, registerUser, resetDb } from './helpers';
import { connectAgent, tool } from './oauth-helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

describe('Moderation, privacy, admin, billing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
  });
  afterAll(async () => app.close());

  async function mutual(pair: Awaited<ReturnType<typeof agentMatchedPair>>, matchId: string, users = [pair.a, pair.b]) {
    for (const u of users) {
      await authed(app, u).get('/matches/today').expect(200);
      await authed(app, u).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['displayName'] }).expect(200);
    }
  }

  describe('reports and blocks', () => {
    it('three distinct reports pause the profile; blocking hides the person everywhere', async () => {
      const pair = await agentMatchedPair(app, { extra: 2 });
      expect(pair.matchIds).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        const bob = pair.others[i];
        const m = await prisma.match.findFirstOrThrow({ where: { id: { in: pair.matchIds }, OR: [{ userAId: bob.id }, { userBId: bob.id }] } });
        await authed(app, bob).post('/reports').send({ matchId: m.id, reason: 'harassment', details: 'rude' }).expect(201);
        if (i === 0) await authed(app, bob).post('/reports').send({ matchId: m.id, reason: 'harassment' }).expect(409);
      }
      expect((await prisma.profile.findUniqueOrThrow({ where: { userId: pair.a.id } })).status).toBe('PAUSED');

      const stranger = await registerUser(app);
      await authed(app, stranger).post('/reports').send({ matchId: pair.matchIds[0], reason: 'other' }).expect(404);

      const { accessToken } = await connectAgent(app, pair.b);
      const bMatch = await prisma.match.findFirstOrThrow({ where: { id: { in: pair.matchIds }, OR: [{ userAId: pair.b.id }, { userBId: pair.b.id }] } });
      await tool(app, accessToken, 'get_candidate_card', { candidateId: bMatch.id }).expect(200);
      await authed(app, pair.b).post('/blocks').send({ matchId: bMatch.id }).expect(200);
      await tool(app, accessToken, 'get_candidate_card', { candidateId: bMatch.id }).expect(404);
      expect((await prisma.match.findUniqueOrThrow({ where: { id: bMatch.id } })).status).toBe('CLOSED');
    });
  });

  describe('privacy', () => {
    it('one-click AI off revokes every agent and stops the built-in agent', async () => {
      const pair = await agentMatchedPair(app);
      const { accessToken } = await connectAgent(app, pair.a);
      await tool(app, accessToken, 'get_profile_schema').expect(200);
      await authed(app, pair.a).put('/privacy/ai').send({ enabled: false }).expect(200);
      await tool(app, accessToken, 'get_profile_schema').expect(401);
      expect(await prisma.agentConnection.count({ where: { userId: pair.a.id, type: 'MCP', revokedAt: null } })).toBe(0);
      expect((await authed(app, pair.a).get('/me')).body.aiEnabled).toBe(false);

      // An open negotiation stalls for this user.
      const neg = await prisma.negotiation.findFirstOrThrow({ where: { matchId: pair.matchIds[0] } });
      await prisma.negotiation.update({ where: { id: neg.id }, data: { status: 'OPEN', nextTurnUserId: pair.a.id } });
      expect(await app.get(BuiltinAgentService).takeTurn(neg.matchId, pair.a.id, { ignoreGrace: true })).toBe('ai_disabled');

      await authed(app, pair.a).put('/privacy/ai').send({ enabled: true }).expect(200);
      const again = await connectAgent(app, pair.a);
      await tool(app, again.accessToken, 'get_profile_schema').expect(200);
    });

    it('exports all personal data, decrypted, without secrets', async () => {
      const u = await registerUser(app);
      await onboardUser(app, u, { sensitive: true });
      await authed(app, u).put('/profile').send({ values: { family: 5, faith: 'buddhist' } }).expect(200);
      const r = await authed(app, u).get('/privacy/export').expect(200);
      expect(r.headers['content-disposition']).toMatch(/attachment; filename="agentmatch-export-/);
      expect(r.body.profile.data.values).toEqual({ family: 5, faith: 'buddhist' });
      expect(r.body.account.email).toBe(u.email);
      expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scrypt\./);
      expect(r.body.consents.map((c: { type: string }) => c.type)).toContain('SENSITIVE_DATA');
    });

    it('deletes the account and everything linked to it', async () => {
      const pair = await agentMatchedPair(app);
      const [matchId] = pair.matchIds;
      await mutual(pair, matchId);
      await authed(app, pair.a).post(`/chats/${matchId}/messages`).send({ body: 'hi' }).expect(201);
      await authed(app, pair.a).post('/profile/photos').attach('file', PNG, 'a.png').expect(201);
      const photo = await prisma.photo.findFirstOrThrow({ where: { userId: pair.a.id } });

      await authed(app, pair.a).delete('/privacy/account').send({ confirmEmail: 'wrong@x.y' }).expect(400);
      await authed(app, pair.a).delete('/privacy/account').send({ confirmEmail: pair.a.email.toUpperCase() }).expect(200);

      expect(await prisma.user.findUnique({ where: { id: pair.a.id } })).toBeNull();
      expect(await prisma.match.findUnique({ where: { id: matchId } })).toBeNull();
      expect(await prisma.chatMessage.count({ where: { senderId: pair.a.id } })).toBe(0);
      expect(await prisma.agentActionLog.count({ where: { userId: pair.a.id } })).toBe(0);
      await expect(app.get<PhotoStorage>(PHOTO_STORAGE).get(photo.storageKey)).rejects.toThrow();
      await request(app.getHttpServer()).post('/auth/login').send({ email: pair.a.email, password: 'correct-horse-9' }).expect(401);
      expect((await authed(app, pair.b).get('/chats').expect(200)).body).toEqual([]);
    });
  });

  describe('admin', () => {
    it('is restricted to staff and exposes users, moderation, weights and metrics', async () => {
      const pair = await agentMatchedPair(app);
      const [matchId] = pair.matchIds;
      await mutual(pair, matchId);
      for (let i = 0; i < 10; i++) await authed(app, i % 2 ? pair.a : pair.b).post(`/chats/${matchId}/messages`).send({ body: `msg ${i}` }).expect(201);
      await authed(app, pair.a).post(`/matches/${matchId}/feedback`).send({ met: true, rating: 4 }).expect(201);
      await authed(app, pair.b).post('/reports').send({ matchId, reason: 'fake_profile' }).expect(201);

      await authed(app, pair.a).get('/admin/metrics').expect(403);
      const admin = await registerUser(app, 'admin@test.local');
      const A = authed(app, admin);

      const users = await A.get(`/admin/users?q=${encodeURIComponent(pair.a.email)}`).expect(200);
      expect(users.body.users[0]).toMatchObject({ email: pair.a.email, reports: 1 });

      const m = await A.get('/admin/metrics').expect(200);
      for (const key of ['profileCompletion', 'aiConnected', 'mutualPerPresentation', 'chats10Plus', 'metRate', 'subscriptionConversion', 'd30Retention']) {
        expect(m.body[key]).toHaveProperty('definition');
        expect(m.body[key]).toHaveProperty('value');
      }
      expect(m.body.chats10Plus.numerator).toBeGreaterThanOrEqual(1);
      expect(m.body.metRate.numerator).toBeGreaterThanOrEqual(1);
      expect(m.body.averageRating.value).toBeGreaterThan(0);
      expect(m.body.mutualPerPresentation.denominator).toBeGreaterThanOrEqual(2);
      expect(m.body.feedbackByScore.length).toBeGreaterThan(0);

      await A.put('/admin/algorithm').send({ weights: { goalsValues: -1, lifestyle: 0, personality: 0, interests: 0, activity: 0 } }).expect(400);
      const updated = await A.put('/admin/algorithm').send({ weights: { goalsValues: 40, lifestyle: 20, personality: 20, interests: 15, activity: 5 } }).expect(200);
      expect(updated.body.weights.goalsValues).toBe(40);
      expect((await A.get('/admin/algorithm').expect(200)).body.weights.lifestyle).toBe(20);

      const reports = await A.get('/admin/reports').expect(200);
      const report = reports.body.find((r: { targetUserId: string }) => r.targetUserId === pair.a.id);
      expect(report.recentChat.length).toBe(10);
      await A.post(`/admin/reports/${report.id}/resolve`).send({ action: 'suspend', note: 'fake' }).expect(200);
      await authed(app, pair.a).get('/me').expect(401);
      expect((await prisma.profile.findUniqueOrThrow({ where: { userId: pair.a.id } })).status).toBe('PAUSED');
    });

    it('moderators can reject photos, which hides them from matches', async () => {
      const pair = await agentMatchedPair(app);
      const [matchId] = pair.matchIds;
      const up = await authed(app, pair.b).post('/profile/photos').attach('file', PNG, 'b.png').expect(201);
      for (const u of [pair.a, pair.b]) {
        await authed(app, u).get('/matches/today').expect(200);
        await authed(app, u).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['photos'] }).expect(200);
      }
      await authed(app, pair.a).get(`/photos/${up.body.id}`).expect(200);
      const mod = await registerUser(app);
      await prisma.user.update({ where: { id: mod.id }, data: { role: 'MODERATOR' } });
      await authed(app, mod).post(`/admin/photos/${up.body.id}`).send({ moderation: 'REJECTED' }).expect(200);
      await authed(app, mod).put('/admin/algorithm').send({}).expect(403); // weights are admin-only
      await authed(app, pair.a).get(`/photos/${up.body.id}`).expect(404);
    });
  });

  describe('billing (mock Stripe)', () => {
    it('subscribing raises the daily quota to 5', async () => {
      const u = await registerUser(app);
      await onboardUser(app, u);
      const c = await authed(app, u).post('/billing/checkout').expect(200);
      expect(c.body.url).toContain('/billing/mock?session=');
      await authed(app, u).post('/billing/mock/complete').send({ sessionId: c.body.sessionId }).expect(200);
      expect((await authed(app, u).get('/billing/subscription')).body.status).toBe('active');
      expect((await authed(app, u).get('/matches/today').expect(200)).body.quota).toBe(5);
      expect((await authed(app, u).get('/me')).body.subscription).not.toBeNull();
      await authed(app, u).post('/billing/cancel').expect(200);
      expect((await authed(app, u).get('/matches/today').expect(200)).body.quota).toBe(3);
    });
  });
});
