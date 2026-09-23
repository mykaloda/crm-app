import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Match, Prisma } from '@prisma/client';
import { ageFromBirthDate, redactProfile } from '@agentmatch/shared';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AlgorithmConfigService } from '../matching/algorithm-config.service';
import { MatchingService, sideOf } from '../matching/matching.service';
import { PhotosService } from '../profile/photos.service';
import { rowToProfileData, rowVisibility } from '../profile/profile.mapper';

/** Fields a person may choose to reveal to a match when liking them. */
export const DISCLOSABLE = ['displayName', 'age', 'city', 'photos', 'description', 'interests'] as const;
export type Disclosable = (typeof DISCLOSABLE)[number];

function startOfDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly matching: MatchingService,
    private readonly algorithm: AlgorithmConfigService,
    private readonly photos: PhotosService,
  ) {}

  private presentedField(side: 'A' | 'B') {
    return side === 'A' ? 'presentedAAt' : 'presentedBAt';
  }

  private async notBlocked(userId: string): Promise<Prisma.MatchWhereInput> {
    const blocks = await this.prisma.block.findMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });
    const ids = blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId));
    return ids.length ? { AND: [{ userAId: { notIn: ids } }, { userBId: { notIn: ids } }] } : {};
  }

  /** Today's 3-5 matches: tops up from agent-approved matches, best score first. */
  async today(userId: string) {
    const config = await this.algorithm.get();
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    const quota = sub?.status === 'active' ? config.dailyMatchesPremium : config.dailyMatchesFree;
    const since = startOfDay();
    const exclude = await this.notBlocked(userId);
    const presentedToday = await this.prisma.match.findMany({
      where: {
        ...exclude,
        OR: [
          { userAId: userId, presentedAAt: { gte: since } },
          { userBId: userId, presentedBAt: { gte: since } },
        ],
      },
    });
    const missing = quota - presentedToday.length;
    if (missing > 0) {
      const fresh = await this.prisma.match.findMany({
        where: {
          ...exclude,
          status: 'AGENT_MATCHED',
          OR: [
            { userAId: userId, presentedAAt: null },
            { userBId: userId, presentedBAt: null },
          ],
        },
        orderBy: { score: 'desc' },
        take: missing,
      });
      const now = new Date();
      for (const m of fresh) {
        await this.prisma.match.update({ where: { id: m.id }, data: { [this.presentedField(sideOf(m, userId))]: now } });
      }
    }
    const rows = await this.prisma.match.findMany({
      where: {
        ...exclude,
        OR: [
          { userAId: userId, presentedAAt: { gte: since } },
          { userBId: userId, presentedBAt: { gte: since } },
        ],
      },
      orderBy: { score: 'desc' },
    });
    return { quota, matches: await Promise.all(rows.map((m) => this.view(userId, m))) };
  }

  /** Card for the human: explanation + anonymised card; personal details only after mutual like and disclosure. */
  async view(userId: string, match: Match) {
    const side = sideOf(match, userId);
    const otherId = side === 'A' ? match.userBId : match.userAId;
    const card = await this.matching.candidateCard(userId, match.id);
    const myDecision = side === 'A' ? match.decisionA : match.decisionB;
    let person: Record<string, unknown> | undefined;
    if (match.status === 'MUTUAL') person = await this.disclosedPerson(userId, otherId, match.id);
    return {
      matchId: match.id,
      status: match.status,
      score: match.score,
      explanation: side === 'A' ? match.explanationA : match.explanationB,
      card: card.card,
      breakdown: card.scoreBreakdownForYou,
      yourDecision: myDecision,
      mutualAt: match.mutualAt,
      person,
    };
  }

  private async disclosedPerson(viewerId: string, ownerId: string, matchId: string) {
    const disclosure = await this.prisma.disclosure.findFirst({ where: { matchId, fromUserId: ownerId, toUserId: viewerId } });
    const fields = new Set(disclosure?.fields ?? []);
    const row = await this.prisma.profile.findUnique({ where: { userId: ownerId } });
    const people = redactProfile(rowToProfileData(row, this.crypto), rowVisibility(row), 'people');
    const all = rowToProfileData(row, this.crypto);
    return {
      displayName: fields.has('displayName') ? people.basic?.displayName : undefined,
      age: fields.has('age') && people.basic?.birthDate ? ageFromBirthDate(people.basic.birthDate) : undefined,
      city: fields.has('city') ? people.basic?.city : undefined,
      description: fields.has('description') ? all.description?.aiDescription : undefined,
      interests: fields.has('interests') ? all.interests?.interestTags : undefined,
      photoIds: fields.has('photos') ? await this.photos.listVisible(viewerId, ownerId) : [],
      disclosedFields: [...fields],
    };
  }

  /**
   * Like or pass. A like is also the human's explicit confirmation of what they
   * reveal to this person once the interest is mutual.
   */
  async decide(userId: string, matchId: string, decision: 'LIKE' | 'PASS', disclose: Disclosable[] = []) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException();
    const side = sideOf(match, userId);
    const otherId = side === 'A' ? match.userBId : match.userAId;
    if (!(side === 'A' ? match.presentedAAt : match.presentedBAt)) throw new ForbiddenException('This match has not been shown to you');
    if (match.status !== 'AGENT_MATCHED') throw new ConflictException({ error: 'already_decided', status: match.status });
    if ((side === 'A' ? match.decisionA : match.decisionB) !== null) throw new ConflictException({ error: 'already_decided' });
    if (decision === 'LIKE' && !disclose.length) throw new BadRequestException('Choose what you want to share if the like is mutual');

    const data: Prisma.MatchUpdateInput = side === 'A' ? { decisionA: decision } : { decisionB: decision };
    const other = side === 'A' ? match.decisionB : match.decisionA;
    if (decision === 'PASS') data.status = 'CLOSED';
    else if (other === 'LIKE') {
      data.status = 'MUTUAL';
      data.mutualAt = new Date();
    }
    await this.prisma.$transaction([
      this.prisma.match.update({ where: { id: matchId }, data }),
      this.prisma.matchFeedback.create({ data: { matchId, userId, liked: decision === 'LIKE' } }),
      ...(decision === 'LIKE'
        ? [this.prisma.disclosure.create({ data: { matchId, fromUserId: userId, toUserId: otherId, fields: [...new Set(disclose)] } })]
        : []),
    ]);
    const updated = await this.prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    return { status: updated.status, mutual: updated.status === 'MUTUAL' };
  }

  async mutual(userId: string) {
    const exclude = await this.notBlocked(userId);
    const rows = await this.prisma.match.findMany({
      where: { ...exclude, status: 'MUTUAL', OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { mutualAt: 'desc' },
    });
    return Promise.all(rows.map((m) => this.view(userId, m)));
  }

  async unmatch(userId: string, matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException();
    sideOf(match, userId);
    await this.prisma.match.update({ where: { id: matchId }, data: { status: 'CLOSED' } });
    return { ok: true };
  }

  /** Post-date feedback, used later to tune weights. */
  async feedback(userId: string, matchId: string, body: { met?: boolean; rating?: number; comment?: string }) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException();
    sideOf(match, userId);
    if (match.status !== 'MUTUAL' && match.status !== 'CLOSED') throw new ConflictException('Feedback is for mutual matches');
    const chatLength = await this.prisma.chatMessage.count({ where: { matchId } });
    return this.prisma.matchFeedback.create({
      data: { matchId, userId, met: body.met, rating: body.rating, comment: body.comment?.slice(0, 2000), chatLength },
    });
  }
}
