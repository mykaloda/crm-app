import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const ratio = (n: number, d: number) => ({ numerator: n, denominator: d, value: d ? Math.round((n / d) * 1000) / 1000 : null });

/** Product metrics for the admin dashboard. Definitions are returned alongside the numbers. */
@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(now = new Date()) {
    const users = await this.prisma.user.count({ where: { role: 'USER' } });
    const [[completed], [connected], presentations, mutual, [chats10], [met], rating, subs, [d30], funnel, feedbackByScore] = await Promise.all([
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM "Profile" p JOIN "User" u ON u.id = p."userId"
        WHERE u.role = 'USER' AND p.status IN ('ACTIVE', 'PAUSED') AND p.completeness >= 80`,
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(DISTINCT c."userId")::int AS n FROM "AgentConnection" c JOIN "User" u ON u.id = c."userId"
        WHERE u.role = 'USER' AND c."revokedAt" IS NULL AND u."aiEnabled"`,
      Promise.all([
        this.prisma.match.count({ where: { presentedAAt: { not: null } } }),
        this.prisma.match.count({ where: { presentedBAt: { not: null } } }),
      ]).then(([a, b]) => a + b),
      this.prisma.match.count({ where: { mutualAt: { not: null } } }),
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM (
          SELECT m.id FROM "Match" m JOIN "ChatMessage" c ON c."matchId" = m.id
          WHERE m."mutualAt" IS NOT NULL GROUP BY m.id HAVING count(c.id) >= 10) t`,
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT count(DISTINCT f."matchId")::int AS n FROM "MatchFeedback" f WHERE f.met = true`,
      this.prisma.matchFeedback.aggregate({ _avg: { rating: true }, _count: { rating: true } }),
      this.prisma.subscription.count({ where: { status: 'active' } }),
      // D30: users who signed up >= 30 days ago and were active on or after day 30.
      this.prisma.$queryRaw<{ cohort: number; retained: number }[]>`
        SELECT count(*)::int AS cohort,
               count(*) FILTER (WHERE EXISTS (
                 SELECT 1 FROM "UserActivityDay" a WHERE a."userId" = u.id AND a.day >= (u."createdAt" + interval '30 days')::date
               ))::int AS retained
        FROM "User" u WHERE u.role = 'USER' AND u."createdAt" <= ${new Date(now.getTime() - 30 * 86_400_000)}`,
      this.prisma.match.groupBy({ by: ['status'], _count: { _all: true } }),
      // Feedback by score bucket: input for re-tuning weights.
      this.prisma.$queryRaw<{ bucket: number; matches: number; avg_rating: number | null; met: number }[]>`
        SELECT (floor(m.score / 10) * 10)::int AS bucket, count(DISTINCT m.id)::int AS matches,
               avg(f.rating)::float8 AS avg_rating, count(DISTINCT f."matchId") FILTER (WHERE f.met)::int AS met
        FROM "Match" m JOIN "MatchFeedback" f ON f."matchId" = m.id
        GROUP BY bucket ORDER BY bucket`,
    ]);
    return {
      generatedAt: now.toISOString(),
      users,
      profileCompletion: { ...ratio(completed.n, users), definition: 'Users with an approved profile at >= 80% completeness / all users' },
      aiConnected: { ...ratio(connected.n, users), definition: 'Users with an active AI connection (MCP, Custom GPT or built-in) and AI enabled / all users' },
      mutualPerPresentation: { ...ratio(mutual, presentations), definition: 'Mutual likes (pairs) / match impressions (per person)' },
      chats10Plus: { ...ratio(chats10.n, mutual), definition: 'Mutual matches with 10+ chat messages / mutual matches' },
      metRate: { ...ratio(met.n, mutual), definition: 'Mutual matches where someone reported meeting / mutual matches' },
      averageRating: { value: rating._avg.rating ? Math.round(rating._avg.rating * 100) / 100 : null, count: rating._count.rating, definition: 'Mean post-date rating (1-5)' },
      subscriptionConversion: { ...ratio(subs, users), definition: 'Active subscriptions / all users' },
      d30Retention: { ...ratio(d30.retained, d30.cohort), definition: 'Users signed up >= 30 days ago who were active on or after day 30 / that cohort' },
      matchFunnel: Object.fromEntries(funnel.map((f) => [f.status, f._count._all])),
      feedbackByScore,
    };
  }
}
