import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Match, Prisma } from '@prisma/client';
import { ScoreBreakdown, ageFromBirthDate, redactProfile } from '@agentmatch/shared';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { rowToProfileData, rowVisibility } from '../profile/profile.mapper';
import { AlgorithmConfigService } from './algorithm-config.service';
import { searchCandidates } from './candidate-search';
import { haversineKm } from './filters';
import { MatchProfile, applyHidden, toMatchProfile } from './match-profile';
import { scorePair } from './scoring';

export interface ScoredCandidate {
  userId: string;
  score: number;
  /** me -> them */
  mine: ScoreBreakdown;
  /** them -> me */
  theirs: ScoreBreakdown;
  distanceKm: number;
  cosine: number | null;
}

/** Match rows store an unordered pair with userAId < userBId. */
export function orderPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

export function sideOf(match: Pick<Match, 'userAId' | 'userBId'>, userId: string): 'A' | 'B' {
  if (match.userAId === userId) return 'A';
  if (match.userBId === userId) return 'B';
  throw new NotFoundException('Candidate not found');
}

export function counterpartOf(match: Pick<Match, 'userAId' | 'userBId'>, userId: string): string {
  return sideOf(match, userId) === 'A' ? match.userBId : match.userAId;
}

/** Remove the person's name from free text shown to other agents. */
export function scrubName(text: string | undefined, name: string | null | undefined): string | undefined {
  if (!text || !name || name.length < 2) return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'this person');
}

export function distanceBucket(km: number): string {
  if (km < 2) return 'under 2 km';
  return `about ${Math.max(5, Math.ceil(km / 5) * 5)} km`;
}

@Injectable()
export class MatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly algorithm: AlgorithmConfigService,
  ) {}

  async loadMatchProfiles(userIds: string[]): Promise<Map<string, MatchProfile>> {
    const rows = await this.prisma.profile.findMany({
      where: { userId: { in: userIds } },
      include: { user: { select: { lastActiveAt: true } } },
    });
    const out = new Map<string, MatchProfile>();
    for (const row of rows) {
      if (!row.birthDate) continue;
      const data = applyHidden(rowToProfileData(row, this.crypto), rowVisibility(row));
      out.set(
        row.userId,
        toMatchProfile(row.userId, data, {
          age: ageFromBirthDate(row.birthDate),
          completeness: row.completeness,
          lastActiveAt: row.user.lastActiveAt,
        }),
      );
    }
    return out;
  }

  /** Steps 1-3: SQL hard filters (both ways) → vector top-K → two-way scoring. */
  async runPipeline(userId: string): Promise<ScoredCandidate[]> {
    const profile = await this.prisma.profile.findUnique({ where: { userId }, include: { user: true } });
    if (!profile || profile.status !== 'ACTIVE') throw new BadRequestException({ error: 'profile_not_active', message: 'Complete and approve the profile first' });
    const config = await this.algorithm.get();
    const raw = await searchCandidates(this.prisma, userId, config.vectorTopK);
    if (!raw.length) return [];
    const profiles = await this.loadMatchProfiles([userId, ...raw.map((r) => r.userId)]);
    const me = profiles.get(userId);
    if (!me) return [];
    const now = new Date();
    const scored: ScoredCandidate[] = [];
    for (const r of raw) {
      const them = profiles.get(r.userId);
      if (!them) continue;
      const s = scorePair(me, them, config.weights, { cosine: r.cosine, now });
      scored.push({ userId: r.userId, score: s.score, mine: s.ab, theirs: s.ba, distanceKm: r.distanceKm, cosine: r.cosine });
    }
    return scored.sort((a, b) => b.score - a.score);
  }

  /** Persist scored pairs as Match rows (new ones start as CANDIDATE). */
  async upsertMatches(userId: string, candidates: ScoredCandidate[]): Promise<Match[]> {
    const out: Match[] = [];
    for (const c of candidates) {
      const [a, b] = orderPair(userId, c.userId);
      const meIsA = a === userId;
      const scores = {
        scoreAB: meIsA ? c.mine.total : c.theirs.total,
        scoreBA: meIsA ? c.theirs.total : c.mine.total,
        score: c.score,
        breakdownAB: (meIsA ? c.mine : c.theirs) as unknown as Prisma.InputJsonValue,
        breakdownBA: (meIsA ? c.theirs : c.mine) as unknown as Prisma.InputJsonValue,
      };
      out.push(
        await this.prisma.match.upsert({
          where: { userAId_userBId: { userAId: a, userBId: b } },
          create: { userAId: a, userBId: b, ...scores },
          update: scores,
        }),
      );
    }
    return out;
  }

  /** Daily / on-demand run: returns CANDIDATE matches that should enter negotiation. */
  async runForUser(userId: string): Promise<Match[]> {
    const config = await this.algorithm.get();
    const scored = (await this.runPipeline(userId)).filter((c) => c.score >= config.minScore).slice(0, config.negotiationTopN);
    const matches = await this.upsertMatches(userId, scored);
    return matches.filter((m) => m.status === 'CANDIDATE');
  }

  async searchForAgent(userId: string, limit: number) {
    const config = await this.algorithm.get();
    const scored = (await this.runPipeline(userId)).filter((c) => c.score >= config.minScore).slice(0, limit);
    const matches = await this.upsertMatches(userId, scored);
    const cards = await Promise.all(matches.map((m) => this.candidateCard(userId, m.id)));
    return {
      candidates: cards.map((c) => ({
        candidateId: c.candidateId,
        score: c.score,
        status: c.status,
        summary: c.summary,
      })),
      note: 'Scores are the minimum of both directions (0-100). Use get_candidate_card for details, then negotiate via send_agent_message.',
    };
  }

  /** Anonymised card: only fields the candidate allowed agents to see; no name, photos, contacts or coordinates. */
  async candidateCard(userId: string, candidateId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: candidateId }, include: { negotiation: true } });
    if (!match) throw new NotFoundException('Candidate not found');
    const side = sideOf(match, userId);
    const otherId = side === 'A' ? match.userBId : match.userAId;
    const [row, mine] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId: otherId } }),
      this.prisma.profile.findUnique({ where: { userId }, select: { lat: true, lng: true } }),
    ]);
    if (!row) throw new NotFoundException('Candidate not found');
    const visibility = rowVisibility(row);
    const visible = redactProfile(rowToProfileData(row, this.crypto), visibility, 'agents');
    const basic = { ...(visible.basic ?? {}) } as Record<string, unknown>;
    const age = basic.birthDate ? ageFromBirthDate(basic.birthDate as string) : undefined;
    delete basic.displayName;
    delete basic.birthDate;
    delete basic.lat;
    delete basic.lng;
    let distance: string | undefined;
    if (mine?.lat != null && mine.lng != null && row.lat != null && row.lng != null) {
      distance = distanceBucket(haversineKm(mine.lat, mine.lng, row.lat, row.lng));
    }
    const breakdown = (side === 'A' ? match.breakdownAB : match.breakdownBA) as unknown as ScoreBreakdown | null;
    const tags = visible.interests?.interestTags ?? [];
    return {
      candidateId: match.id,
      score: match.score,
      status: match.status,
      negotiation: match.negotiation
        ? { status: match.negotiation.status, messages: match.negotiation.messageCount, yourVerdict: side === 'A' ? match.negotiation.verdictA : match.negotiation.verdictB }
        : null,
      summary: [age ? `${age} y.o.` : null, visible.goals?.relationshipType?.replace('_', ' '), distance, tags.slice(0, 4).join(', ')]
        .filter(Boolean)
        .join(' · '),
      card: {
        age,
        approximateDistance: distance,
        ...(Object.keys(basic).length ? { basic } : {}),
        goals: visible.goals,
        lifestyle: visible.lifestyle,
        values: visible.values,
        personality: visible.personality,
        interests: visible.interests && {
          ...visible.interests,
          interestsText: scrubName(visible.interests.interestsText, row.displayName),
        },
        description: scrubName(visible.description?.aiDescription, row.displayName),
      },
      scoreBreakdownForYou: breakdown,
      privacy: 'Anonymised. Name, photos, contacts and exact location are never shared with agents.',
    };
  }

  async listMatchesForAgent(userId: string, status: string) {
    const where: Prisma.MatchWhereInput = { OR: [{ userAId: userId }, { userBId: userId }] };
    if (status === 'pending') where.status = { in: ['CANDIDATE', 'NEGOTIATING'] };
    else if (status === 'presented') where.status = 'AGENT_MATCHED';
    else if (status === 'mutual') where.status = 'MUTUAL';
    else where.status = { in: ['NEGOTIATING', 'AGENT_MATCHED', 'MUTUAL'] };
    const matches = await this.prisma.match.findMany({ where, orderBy: { score: 'desc' }, take: 50, include: { negotiation: true } });
    const out = [];
    for (const m of matches) {
      const side = sideOf(m, userId);
      const otherId = side === 'A' ? m.userBId : m.userAId;
      const disclosure = await this.prisma.disclosure.findFirst({ where: { matchId: m.id, fromUserId: otherId, toUserId: userId } });
      let person: Record<string, unknown> | undefined;
      if (m.status === 'MUTUAL' && disclosure) {
        const row = await this.prisma.profile.findUnique({ where: { userId: otherId } });
        const people = redactProfile(rowToProfileData(row, this.crypto), rowVisibility(row), 'people');
        person = {
          displayName: disclosure.fields.includes('displayName') ? people.basic?.displayName : undefined,
          city: disclosure.fields.includes('city') ? people.basic?.city : undefined,
          photos: disclosure.fields.includes('photos') ? 'available on the website' : undefined,
        };
      }
      out.push({
        candidateId: m.id,
        status: m.status,
        score: m.score,
        explanation: side === 'A' ? m.explanationA : m.explanationB,
        yourHumanDecision: side === 'A' ? m.decisionA : m.decisionB,
        negotiation: m.negotiation ? { status: m.negotiation.status, outcome: m.negotiation.outcome } : null,
        person,
      });
    }
    return { matches: out };
  }
}
