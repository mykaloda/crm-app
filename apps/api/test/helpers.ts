import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { RedisService } from '../src/common/redis.service';
import { loadConfig } from '../src/config/config';

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: ['error'] });
  configureApp(app, loadConfig());
  await app.init();
  return app;
}

export async function resetDb(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  await app.get(RedisService).client.flushdb();
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
}

let counter = 0;

export async function registerUser(app: INestApplication, email?: string): Promise<TestUser> {
  email ??= `user${Date.now()}_${counter++}@test.local`;
  const res = await request(app.getHttpServer()).post('/auth/register').send({ email, password: 'correct-horse-9' }).expect(201);
  return { id: res.body.userId, email, token: res.body.accessToken };
}

export function authed(app: INestApplication, user: TestUser) {
  const server = app.getHttpServer();
  const h = { Authorization: `Bearer ${user.token}` };
  return {
    get: (url: string) => request(server).get(url).set(h),
    post: (url: string) => request(server).post(url).set(h),
    put: (url: string) => request(server).put(url).set(h),
    delete: (url: string) => request(server).delete(url).set(h),
  };
}

/** Consent + mock 18+ verification. */
export async function onboardUser(app: INestApplication, user: TestUser, opts: { sensitive?: boolean } = {}) {
  const a = authed(app, user);
  await a.post('/me/consents').send({ terms: true, privacy: true, aiProcessing: true, sensitiveData: !!opts.sensitive }).expect(200);
  const start = await a.post('/verification/age/start').expect(200);
  await a.post('/verification/age/mock/complete').send({ sessionId: start.body.sessionId, birthDate: '1992-04-10' }).expect(200);
}

export const DESCRIPTION = Array.from(
  { length: 170 },
  (_, i) => ['kind', 'curious', 'hiking', 'mountains', 'cooking', 'books', 'travel', 'music', 'honest', 'calm'][i % 10],
).join(' ');

export function fullProfile(overrides: Record<string, Record<string, unknown>> = {}) {
  const base = {
    basic: { displayName: 'Alex', birthDate: '1992-04-10', gender: 'woman', seeking: ['man'], ageMin: 28, ageMax: 42, city: 'Berlin', lat: 52.52, lng: 13.405, radiusKm: 50 },
    goals: { relationshipType: 'long_term', hasChildren: false, wantsChildren: 'yes', timeline: 'within_1y' },
    lifestyle: { smoking: 'never', alcohol: 'socially', exercise: 'often', schedule: 'early_bird', pets: 'dog', relocation: 'maybe' },
    values: { family: 5, career: 3, money: 3 },
    personality: { openness: 70, conscientiousness: 60, extraversion: 50, agreeableness: 70, neuroticism: 30, communicationStyle: 'direct', temperament: 'balanced' },
    interests: { interestTags: ['hiking', 'cooking', 'books'], interestsText: 'Weekend hikes and long dinners' },
    dealBreakers: { excludeSmoking: ['regularly'], excludeAlcohol: [], excludePets: [], noPartnerChildren: false },
    description: { aiDescription: DESCRIPTION },
  };
  for (const [k, v] of Object.entries(overrides)) (base as Record<string, Record<string, unknown>>)[k] = { ...(base as Record<string, Record<string, unknown>>)[k], ...v };
  return base;
}

let pairCity = 0;
/**
 * Two compatible users (built-in agents) placed in their own "city", negotiated to AGENT_MATCHED.
 * Extra users can be added to the same city via `extra`.
 */
export async function agentMatchedPair(app: INestApplication, opts: { extra?: number } = {}) {
  const { MatchingService } = await import('../src/matching/matching.service');
  const { NegotiationService } = await import('../src/negotiation/negotiation.service');
  const { BuiltinAgentService } = await import('../src/negotiation/builtin-agent.service');
  const lng = -150 + pairCity++ * 3;
  const a = await registerUser(app);
  await onboardUser(app, a);
  await authed(app, a).put('/profile').send(fullProfile({ basic: { displayName: 'Alice', gender: 'woman', seeking: ['man'], lat: -20, lng } })).expect(200);
  const others: TestUser[] = [];
  for (let i = 0; i < 1 + (opts.extra ?? 0); i++) {
    const b = await registerUser(app);
    await onboardUser(app, b);
    await authed(app, b)
      .put('/profile')
      .send(fullProfile({ basic: { displayName: `Bob${i}`, gender: 'man', seeking: ['woman'], birthDate: '1989-02-02', lat: -20.02 - i * 0.01, lng } }))
      .expect(200);
    others.push(b);
  }
  const matches = await app.get(MatchingService).runForUser(a.id);
  const negotiations = app.get(NegotiationService);
  const builtin = app.get(BuiltinAgentService);
  for (const m of matches) {
    await negotiations.start(m.id, a.id);
    await builtin.runToCompletion(m.id);
  }
  return { a, b: others[0], others, matchIds: matches.map((m) => m.id) };
}
