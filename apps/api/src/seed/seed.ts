/* eslint-disable no-console */
import 'reflect-metadata';
import { loadDotEnv } from '../load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../common/prisma.service';
import { MatchingService } from '../matching/matching.service';
import { SEED_DOMAIN, createSeedUser, seedSynthetic } from './seed-runner';
import { generatePeople } from './synthetic';

/**
 * Usage: pnpm --filter @agentmatch/api seed [--reset] [--count 200]
 * Creates 200 synthetic profiles plus demo@agentmatch.local and admin@agentmatch.local.
 */
async function main() {
  loadDotEnv();
  process.env.MATCHING_ENABLE_SCHEDULER = 'false';
  const args = process.argv.slice(2);
  const count = Number(args[args.indexOf('--count') + 1]) || 200;
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = ctx.get(PrismaService);

  if (args.includes('--reset')) {
    const r = await prisma.user.deleteMany({
      where: { OR: [{ email: { endsWith: `@${SEED_DOMAIN}` } }, { email: { in: ['demo@agentmatch.local', 'admin@agentmatch.local'] } }] },
    });
    console.log(`Removed ${r.count} seed users`);
  }

  const t0 = Date.now();
  const { created } = await seedSynthetic(ctx, count);
  console.log(`Synthetic profiles: ${created} created (${count} requested) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const demoData = generatePeople(1, 7, 'x')[0].data;
  demoData.basic = { ...demoData.basic, displayName: 'Demo', gender: 'woman', seeking: ['man'], birthDate: '1993-05-20', ageMin: 28, ageMax: 42, city: 'Berlin', lat: 52.52, lng: 13.405, radiusKm: 60 };
  demoData.goals = { relationshipType: 'long_term', hasChildren: false, wantsChildren: 'maybe', timeline: 'within_1y' };
  for (const [email, role, data] of [
    ['demo@agentmatch.local', 'USER', demoData],
    ['admin@agentmatch.local', 'ADMIN', { ...demoData, basic: { ...demoData.basic, displayName: 'Admin' } }],
  ] as const) {
    if (!(await prisma.user.findUnique({ where: { email } }))) {
      await createSeedUser(ctx, { email, sensitive: false, lastActiveDaysAgo: 0, data }, { role, password: 'demo-password-1' });
      console.log(`Created ${email} / demo-password-1`);
    }
  }

  const demo = await prisma.user.findUniqueOrThrow({ where: { email: 'demo@agentmatch.local' } });
  const results = await ctx.get(MatchingService).runPipeline(demo.id);
  const names = await prisma.profile.findMany({ where: { userId: { in: results.slice(0, 5).map((r) => r.userId) } }, select: { userId: true, displayName: true, city: true } });
  console.log(`\nMatching check for demo@agentmatch.local: ${results.length} candidates passed hard filters (both directions)`);
  for (const r of results.slice(0, 5)) {
    const p = names.find((n) => n.userId === r.userId);
    console.log(`  ${p?.displayName?.padEnd(8)} ${p?.city?.padEnd(8)} score ${r.score.toFixed(1)} (me→them ${r.mine.total}, them→me ${r.theirs.total}), cosine ${r.cosine?.toFixed(2)}`);
  }
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
