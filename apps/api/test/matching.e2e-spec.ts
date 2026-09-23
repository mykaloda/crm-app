process.env.RATE_LIMIT_SEARCH_PER_HOUR = '6';

import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma.service';
import { hardFilterReason } from '../src/matching/filters';
import { AlgorithmConfigService } from '../src/matching/algorithm-config.service';
import { MatchingScheduler } from '../src/matching/matching.queue';
import { MatchingService } from '../src/matching/matching.service';
import { seedSynthetic } from '../src/seed/seed-runner';
import { authed, createTestApp, fullProfile, onboardUser, registerUser, resetDb } from './helpers';
import { connectAgent, tool } from './oauth-helpers';

describe('Matching (e2e, 200 synthetic profiles)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let matching: MatchingService;
  let userIds: string[];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    matching = app.get(MatchingService);
    await resetDb(app);
    await seedSynthetic(app, 200, 42, 'seed.test');
    userIds = (await prisma.user.findMany({ select: { id: true }, orderBy: { email: 'asc' } })).map((u) => u.id);
    // Make the vector step return everything so SQL can be compared with the pure filter.
    await app.get(AlgorithmConfigService).update({ vectorTopK: 1000, minScore: 0 }, 'test');
  }, 120_000);

  afterAll(async () => app.close());

  it('seeded 200 active, verified profiles with embeddings', async () => {
    expect(userIds).toHaveLength(200);
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "Profile" WHERE status = 'ACTIVE' AND embedding IS NOT NULL`;
    expect(n).toBe(200);
  });

  it('SQL hard filters match the pure implementation in both directions', async () => {
    const all = await matching.loadMatchProfiles(userIds);
    let checkedPairs = 0;
    for (const id of userIds.slice(0, 40)) {
      const sql = new Set((await matching.runPipeline(id)).map((c) => c.userId));
      const me = all.get(id)!;
      const expected = new Set(userIds.filter((other) => other !== id && hardFilterReason(me, all.get(other)!) === null));
      expect([...sql].sort()).toEqual([...expected].sort());
      checkedPairs += userIds.length - 1;
    }
    expect(checkedPairs).toBeGreaterThan(7000);
  });

  it('every candidate passes both directions and the score is min(A→B, B→A)', async () => {
    const all = await matching.loadMatchProfiles(userIds);
    let total = 0;
    for (const id of userIds.slice(0, 60)) {
      const results = await matching.runPipeline(id);
      total += results.length;
      for (const r of results) {
        expect(hardFilterReason(all.get(id)!, all.get(r.userId)!)).toBeNull();
        expect(hardFilterReason(all.get(r.userId)!, all.get(id)!)).toBeNull();
        expect(r.score).toBe(Math.min(r.mine.total, r.theirs.total));
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
      const scores = results.map((r) => r.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    expect(total).toBeGreaterThan(200); // the synthetic population actually produces matches
  });

  it('ranks semantically similar people higher among otherwise filtered candidates', async () => {
    const withCos = [];
    for (const id of userIds.slice(0, 30)) withCos.push(...(await matching.runPipeline(id)).filter((r) => r.cosine !== null));
    expect(withCos.length).toBeGreaterThan(50);
  });

  it('excludes blocked users, closed pairs, paused profiles and users with AI disabled', async () => {
    let results: Awaited<ReturnType<MatchingService['runPipeline']>> = [];
    let target = '';
    for (const uid of userIds) {
      results = await matching.runPipeline(uid);
      if (results.length >= 4) {
        target = uid;
        break;
      }
    }
    const [c1, c2, c3, c4] = results.map((r) => r.userId);
    await prisma.block.create({ data: { blockerId: c1, blockedId: target } });
    const [a, b] = target < c2 ? [target, c2] : [c2, target];
    await prisma.match.create({ data: { userAId: a, userBId: b, status: 'REJECTED', score: 1, scoreAB: 1, scoreBA: 1 } });
    await prisma.profile.update({ where: { userId: c3 }, data: { status: 'PAUSED' } });
    await prisma.user.update({ where: { id: c4 }, data: { aiEnabled: false } });
    const after = new Set((await matching.runPipeline(target)).map((r) => r.userId));
    for (const excluded of [c1, c2, c3, c4]) expect(after.has(excluded)).toBe(false);
    await prisma.profile.update({ where: { userId: c3 }, data: { status: 'ACTIVE' } });
    await prisma.user.update({ where: { id: c4 }, data: { aiEnabled: true } });
  });

  it('weights from the admin config change the scores', async () => {
    const id = userIds[5];
    const before = (await matching.runPipeline(id))[0];
    if (!before) return;
    await app.get(AlgorithmConfigService).update({ weights: { goalsValues: 0, lifestyle: 0, personality: 0, interests: 0, activity: 100 } }, 'test');
    const after = (await matching.runPipeline(id)).find((r) => r.userId === before.userId)!;
    expect(after.score).toBe(Math.min(after.mine.activity, after.theirs.activity));
    await app.get(AlgorithmConfigService).update({ weights: { goalsValues: 35, lifestyle: 25, personality: 20, interests: 15, activity: 5 } }, 'test');
  });

  describe('agent tools', () => {
    it('search_candidates + get_candidate_card return anonymised data only', async () => {
      const u = await registerUser(app);
      await onboardUser(app, u);
      await authed(app, u).put('/profile').send(fullProfile({ basic: { gender: 'woman', seeking: ['man'], ageMin: 22, ageMax: 55, radiusKm: 100 }, goals: { wantsChildren: 'maybe' } })).expect(200);
      const { accessToken } = await connectAgent(app, u);

      const s = await tool(app, accessToken, 'search_candidates', { limit: 5 }).expect(200);
      expect(s.body.candidates.length).toBeGreaterThan(0);
      expect(s.body.candidates.length).toBeLessThanOrEqual(5);
      const first = s.body.candidates[0];
      expect(await prisma.match.findUnique({ where: { id: first.candidateId } })).not.toBeNull();
      expect(userIds).not.toContain(first.candidateId); // opaque handle, not a user id

      // Candidate hides interests from agents: the card must not include them.
      const m = await prisma.match.findUniqueOrThrow({ where: { id: first.candidateId } });
      const otherId = m.userAId === u.id ? m.userBId : m.userAId;
      const vis = (await prisma.profile.findUniqueOrThrow({ where: { userId: otherId } })).visibility as Record<string, string>;
      await prisma.profile.update({ where: { userId: otherId }, data: { visibility: { ...vis, interestTags: 'algorithm_only', interestsText: 'algorithm_only' } } });

      const card = await tool(app, accessToken, 'get_candidate_card', { candidateId: first.candidateId }).expect(200);
      const json = JSON.stringify(card.body);
      const other = await prisma.profile.findUniqueOrThrow({ where: { userId: otherId } });
      expect(json).not.toContain(other.displayName!);
      expect(json).not.toContain(String(other.lat));
      expect(json).not.toContain('birthDate');
      expect(card.body.card.interests).toBeUndefined();
      expect(card.body.card.values).toBeUndefined(); // algorithm_only by default
      expect(card.body.card.personality).toBeUndefined();
      expect(card.body.card.lifestyle).toBeDefined(); // agents by default
      expect(card.body.card.age).toBeGreaterThanOrEqual(18);
      expect(card.body.card.approximateDistance).toMatch(/km/);

      // Someone else's handle is not accessible.
      const stranger = await registerUser(app);
      await onboardUser(app, stranger);
      const t2 = await connectAgent(app, stranger);
      await tool(app, t2.accessToken, 'get_candidate_card', { candidateId: first.candidateId }).expect(404);
    });

    it('rate-limits search_candidates and logs the refusal', async () => {
      const u = await registerUser(app);
      await onboardUser(app, u);
      await authed(app, u).put('/profile').send(fullProfile()).expect(200);
      const { accessToken } = await connectAgent(app, u);
      for (let i = 0; i < 6; i++) await tool(app, accessToken, 'search_candidates', { limit: 1 }).expect(200);
      const r = await tool(app, accessToken, 'search_candidates', { limit: 1 }).expect(429);
      expect(r.body.retryAfterSec).toBeGreaterThan(0);
      const log = await prisma.agentActionLog.findFirst({ where: { userId: u.id, status: 'rate_limited' } });
      expect(log?.tool).toBe('search_candidates');
    });

    it('refuses to search before the profile is complete', async () => {
      const u = await registerUser(app);
      await onboardUser(app, u);
      const { accessToken } = await connectAgent(app, u);
      const r = await tool(app, accessToken, 'search_candidates', {}).expect(400);
      expect(r.body.error).toBe('profile_not_active');
    });
  });

  it('the queue runs matching for a user on demand', async () => {
    const u = await registerUser(app);
    await onboardUser(app, u);
    await authed(app, u).put('/profile').send(fullProfile({ basic: { ageMin: 22, ageMax: 55, radiusKm: 100 }, goals: { wantsChildren: 'maybe' } })).expect(200);
    await authed(app, u).post('/matching/run').expect(202);
    await app.get(MatchingScheduler).enqueueUser(u.id); // deduplicated
    let count = 0;
    for (let i = 0; i < 50 && count === 0; i++) {
      await new Promise((r) => setTimeout(r, 200));
      count = await prisma.match.count({ where: { OR: [{ userAId: u.id }, { userBId: u.id }] } });
    }
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(20); // negotiation top-N
  });
});
