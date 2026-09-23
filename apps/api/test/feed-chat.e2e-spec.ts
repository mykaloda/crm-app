import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import { PrismaService } from '../src/common/prisma.service';
import { AlgorithmConfigService } from '../src/matching/algorithm-config.service';
import { agentMatchedPair, authed, createTestApp, resetDb } from './helpers';
import { connectAgent, tool } from './oauth-helpers';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

describe('Feed, likes, disclosure, chat, feedback (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    await app.listen(0);
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });
  afterAll(async () => app.close());

  it('shows agent-approved matches anonymously, reveals only what each person disclosed', async () => {
    const { a, b, matchIds } = await agentMatchedPair(app);
    const [matchId] = matchIds;
    const photo = await authed(app, b).post('/profile/photos').attach('file', PNG, 'b.png').expect(201);
    await authed(app, a).post('/profile/photos').attach('file', PNG, 'a.png').expect(201);

    // Not shown to B yet → cannot decide.
    await authed(app, b).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['displayName'] }).expect(403);

    const feedA = await authed(app, a).get('/matches/today').expect(200);
    expect(feedA.body.quota).toBe(3);
    expect(feedA.body.matches).toHaveLength(1);
    const item = feedA.body.matches[0];
    expect(item.explanation).toMatch(/recommend/);
    expect(item.person).toBeUndefined();
    expect(JSON.stringify(item)).not.toContain('Bob0');

    await authed(app, a).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE' }).expect(400); // must choose disclosures
    const likeA = await authed(app, a).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['displayName', 'age'] }).expect(200);
    expect(likeA.body.mutual).toBe(false);
    await authed(app, a).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['displayName'] }).expect(409);

    // Chat is closed until the like is mutual.
    await authed(app, a).post(`/chats/${matchId}/messages`).send({ body: 'hi' }).expect(403);

    await authed(app, b).get('/matches/today').expect(200);
    const likeB = await authed(app, b).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['displayName', 'photos', 'city'] }).expect(200);
    expect(likeB.body.mutual).toBe(true);

    const mutualA = await authed(app, a).get('/matches/mutual').expect(200);
    expect(mutualA.body[0].person).toMatchObject({ displayName: 'Bob0', city: 'Berlin', photoIds: [photo.body.id] });
    expect(mutualA.body[0].person.age).toBeUndefined();
    const mutualB = await authed(app, b).get('/matches/mutual').expect(200);
    expect(mutualB.body[0].person).toMatchObject({ displayName: 'Alice', age: expect.any(Number), photoIds: [] });

    // Photos: A may see B's (disclosed), B may not see A's (not disclosed).
    await authed(app, a).get(`/photos/${photo.body.id}`).expect(200);
    const aPhoto = await prisma.photo.findFirstOrThrow({ where: { userId: a.id } });
    await authed(app, b).get(`/photos/${aPhoto.id}`).expect(403);

    // The agent sees personal details only as disclosed.
    const { accessToken } = await connectAgent(app, a);
    const agentView = await tool(app, accessToken, 'get_matches', { status: 'mutual' }).expect(200);
    expect(agentView.body.matches[0].person).toMatchObject({ displayName: 'Bob0', city: 'Berlin' });
  });

  it('respects the daily quota and PASS closes the match', async () => {
    await app.get(AlgorithmConfigService).update({ dailyMatchesFree: 1 }, 'test');
    const { a, matchIds } = await agentMatchedPair(app, { extra: 1 });
    expect(matchIds).toHaveLength(2);
    const feed = await authed(app, a).get('/matches/today').expect(200);
    expect(feed.body.matches).toHaveLength(1);
    const again = await authed(app, a).get('/matches/today').expect(200);
    expect(again.body.matches.map((m: { matchId: string }) => m.matchId)).toEqual(feed.body.matches.map((m: { matchId: string }) => m.matchId));
    await authed(app, a).post(`/matches/${feed.body.matches[0].matchId}/decision`).send({ decision: 'PASS' }).expect(200);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: feed.body.matches[0].matchId } })).status).toBe('CLOSED');
    await app.get(AlgorithmConfigService).update({ dailyMatchesFree: 3 }, 'test');
  });

  it('chat works over REST and Socket.IO, blocks stop it, feedback records chat length', async () => {
    const { a, b, matchIds } = await agentMatchedPair(app);
    const [matchId] = matchIds;
    for (const u of [a, b]) {
      await authed(app, u).get('/matches/today').expect(200);
      await authed(app, u).post(`/matches/${matchId}/decision`).send({ decision: 'LIKE', disclose: ['displayName'] }).expect(200);
    }

    const socketB = io(`${baseUrl}/chat`, { auth: { token: b.token }, transports: ['websocket'] });
    const received: { body: string }[] = [];
    socketB.on('message:new', (m) => received.push(m));
    await new Promise<void>((resolve, reject) => {
      socketB.on('connect', () => resolve());
      socketB.on('connect_error', reject);
    });
    await new Promise((r) => setTimeout(r, 100));

    await authed(app, a).post(`/chats/${matchId}/messages`).send({ body: 'Hi Bob! Coffee this weekend?' }).expect(201);
    const ack = await socketB.timeout(2000).emitWithAck('message:send', { matchId, body: 'Sounds great!' });
    expect(ack.ok).toBe(true);
    for (let i = 0; i < 20 && received.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
    expect(received.map((m) => m.body)).toEqual(['Hi Bob! Coffee this weekend?', 'Sounds great!']);

    const list = await authed(app, a).get('/chats').expect(200);
    expect(list.body[0]).toMatchObject({ matchId, title: 'Bob0', unread: 1 });
    await authed(app, a).post(`/chats/${matchId}/read`).expect(200);
    const msgs = await authed(app, a).get(`/chats/${matchId}/messages`).expect(200);
    expect(msgs.body.map((m: { mine: boolean }) => m.mine)).toEqual([true, false]);

    // Unauthenticated sockets are dropped.
    const anon = io(`${baseUrl}/chat`, { transports: ['websocket'] });
    await new Promise<void>((resolve) => anon.on('disconnect', () => resolve()));
    anon.close();

    const fb = await authed(app, a).post(`/matches/${matchId}/feedback`).send({ met: true, rating: 5, comment: 'Lovely evening' }).expect(201);
    expect(fb.body).toMatchObject({ met: true, rating: 5, chatLength: 2 });
    await authed(app, a).post(`/matches/${matchId}/feedback`).send({ rating: 9 }).expect(400);

    await prisma.block.create({ data: { blockerId: b.id, blockedId: a.id } });
    await authed(app, a).post(`/chats/${matchId}/messages`).send({ body: 'still there?' }).expect(403);
    socketB.close();
  });
});
