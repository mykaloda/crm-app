import { INestApplicationContext } from '@nestjs/common';
import { ProfileData } from '@agentmatch/shared';
import { ConsentService } from '../common/consent.service';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { ProfileService } from '../profile/profile.service';
import { SyntheticPerson, generatePeople } from './synthetic';

export const SEED_DOMAIN = 'seed.agentmatch.local';
export const SEED_PASSWORD = 'seed-password-1';

/** Creates a verified, consented user with an approved profile and the built-in agent connected. */
export async function createSeedUser(
  ctx: INestApplicationContext,
  person: Pick<SyntheticPerson, 'email' | 'sensitive' | 'lastActiveDaysAgo'> & { data: ProfileData },
  opts: { role?: 'USER' | 'ADMIN'; password?: string } = {},
) {
  const prisma = ctx.get(PrismaService);
  const crypto = ctx.get(CryptoService);
  const consents = ctx.get(ConsentService);
  const profiles = ctx.get(ProfileService);
  const lastActiveAt = new Date(Date.now() - person.lastActiveDaysAgo * 86_400_000);
  const user = await prisma.user.create({
    data: {
      email: person.email,
      passwordHash: await crypto.hashPassword(opts.password ?? SEED_PASSWORD),
      role: opts.role ?? 'USER',
      ageVerificationStatus: 'VERIFIED',
      ageVerifiedAt: new Date(),
      lastActiveAt,
      createdAt: new Date(Date.now() - (person.lastActiveDaysAgo + 20) * 86_400_000),
    },
  });
  for (const t of ['TERMS', 'PRIVACY', 'AI_PROCESSING'] as const) await consents.grant(user.id, t);
  if (person.sensitive) await consents.grant(user.id, 'SENSITIVE_DATA');
  await prisma.agentConnection.create({ data: { userId: user.id, type: 'BUILTIN', label: 'Built-in agent' } });
  await profiles.applyChanges(user.id, person.data);
  await prisma.userActivityDay.create({ data: { userId: user.id, day: new Date(lastActiveAt.toISOString().slice(0, 10)) } });
  return user;
}

export async function seedSynthetic(ctx: INestApplicationContext, n = 200, seed = 42, domain = SEED_DOMAIN) {
  const prisma = ctx.get(PrismaService);
  const people = generatePeople(n, seed, domain);
  const existing = new Set((await prisma.user.findMany({ where: { email: { endsWith: `@${domain}` } }, select: { email: true } })).map((u) => u.email));
  let created = 0;
  for (const p of people) {
    if (existing.has(p.email)) continue;
    await createSeedUser(ctx, p);
    created++;
  }
  return { created, total: people.length, people };
}
