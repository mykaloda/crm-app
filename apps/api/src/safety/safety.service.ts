import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { counterpartOf } from '../matching/matching.service';

/** Distinct reporters with open reports after which a profile is paused pending review. */
export const AUTO_PAUSE_REPORTS = 3;

@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService) {}

  /** Users only know each other through a match, so reports and blocks reference the match. */
  private async counterpart(userId: string, matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException();
    return counterpartOf(match, userId);
  }

  async report(userId: string, matchId: string, reason: string, details?: string) {
    const targetUserId = await this.counterpart(userId, matchId);
    const existing = await this.prisma.report.findFirst({ where: { reporterId: userId, targetUserId, status: 'OPEN' } });
    if (existing) throw new ConflictException('You already reported this person');
    const report = await this.prisma.report.create({ data: { reporterId: userId, targetUserId, matchId, reason, details: details?.slice(0, 2000) } });
    const reporters = await this.prisma.report.groupBy({ by: ['reporterId'], where: { targetUserId, status: 'OPEN' } });
    if (reporters.length >= AUTO_PAUSE_REPORTS) {
      await this.prisma.profile.updateMany({ where: { userId: targetUserId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    }
    return { reportId: report.id };
  }

  async block(userId: string, matchId: string) {
    const blockedId = await this.counterpart(userId, matchId);
    await this.prisma.$transaction([
      this.prisma.block.upsert({ where: { blockerId_blockedId: { blockerId: userId, blockedId } }, create: { blockerId: userId, blockedId }, update: {} }),
      this.prisma.match.update({ where: { id: matchId }, data: { status: 'CLOSED' } }),
      this.prisma.negotiation.updateMany({ where: { matchId, status: 'OPEN' }, data: { status: 'CONCLUDED', outcome: 'no_match', concludedAt: new Date() } }),
    ]);
    return { blocked: true };
  }

  async blocks(userId: string) {
    const rows = await this.prisma.block.findMany({ where: { blockerId: userId }, orderBy: { createdAt: 'desc' } });
    return rows.map((b) => ({ id: b.blockedId.slice(-6), createdAt: b.createdAt }));
  }
}
