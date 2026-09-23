import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Match, Negotiation } from '@prisma/client';
import { Queue } from 'bullmq';
import { UNTRUSTED_NOTICE, checkAgentMessage } from '@agentmatch/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../common/prisma.service';
import { AgentContext } from '../agent-tools/agent-context';
import { sideOf } from '../matching/matching.service';

export const NEGOTIATION_QUEUE = 'negotiation';

export class SafetyBlockedError extends BadRequestException {
  constructor(categories: string[]) {
    super({
      error: 'blocked_by_safety_filter',
      categories,
      message: 'Agents may not exchange or request contact details, addresses, links, money or instructions to other agents.',
    });
  }
}

const OPEN_MATCH = ['CANDIDATE', 'NEGOTIATING'] as const;

@Injectable()
export class NegotiationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(NEGOTIATION_QUEUE) private readonly queue: Queue,
  ) {}

  get maxMessages() {
    return this.config.NEGOTIATION_MAX_MESSAGES;
  }

  private async load(userId: string, candidateId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: candidateId }, include: { negotiation: true } });
    if (!match) throw new NotFoundException('Candidate not found');
    const side = sideOf(match, userId);
    const otherId = side === 'A' ? match.userBId : match.userAId;
    const blocked = await this.prisma.block.count({
      where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] },
    });
    if (blocked) throw new NotFoundException('Candidate not found');
    return { match, side, otherId };
  }

  private async ensureNegotiation(match: Match & { negotiation: Negotiation | null }, initiatorId: string): Promise<Negotiation> {
    if (match.negotiation) return match.negotiation;
    if (!OPEN_MATCH.includes(match.status as (typeof OPEN_MATCH)[number])) throw new ConflictException({ error: 'negotiation_closed' });
    const [neg] = await this.prisma.$transaction([
      this.prisma.negotiation.upsert({
        where: { matchId: match.id },
        create: { matchId: match.id, nextTurnUserId: initiatorId, turnSince: new Date() },
        update: {},
      }),
      this.prisma.match.update({ where: { id: match.id }, data: { status: 'NEGOTIATING' } }),
    ]);
    return neg;
  }

  /** Called after a matching run: open negotiations and let the initiator's agent speak first. */
  async start(matchId: string, initiatorId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { negotiation: true } });
    if (!match || match.negotiation || match.status !== 'CANDIDATE') return;
    await this.ensureNegotiation(match, initiatorId);
    await this.scheduleTurn(matchId, initiatorId);
  }

  async scheduleTurn(matchId: string, userId: string, delayMs = 0) {
    if (!this.config.NEGOTIATION_AUTORUN) return;
    const neg = await this.prisma.negotiation.findUnique({ where: { matchId } });
    await this.queue.add(
      'turn',
      { matchId, userId },
      { jobId: `turn-${matchId}-${userId}-${neg?.messageCount ?? 0}-${neg?.verdictA ?? ''}${neg?.verdictB ?? ''}-${delayMs}`, delay: delayMs, removeOnComplete: 500, removeOnFail: 500 },
    );
  }

  async sendMessage(ctx: AgentContext, candidateId: string, kind: string, content: string) {
    const { match, side, otherId } = await this.load(ctx.userId, candidateId);
    const filter = checkAgentMessage(content);
    if (filter.blocked) throw new SafetyBlockedError(filter.categories);
    const neg = await this.ensureNegotiation(match, ctx.userId);
    if (neg.status !== 'OPEN') throw new ConflictException({ error: 'negotiation_closed', message: 'This negotiation is already concluded' });
    const ownVerdict = side === 'A' ? neg.verdictA : neg.verdictB;
    if (ownVerdict === 'no_match') throw new ConflictException({ error: 'negotiation_closed' });
    if (neg.messageCount >= this.maxMessages) {
      throw new ConflictException({ error: 'message_budget_exhausted', message: 'No messages left: give a verdict with propose_match' });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.negotiation.updateMany({
        where: { id: neg.id, messageCount: { lt: this.maxMessages }, status: 'OPEN' },
        data: { messageCount: { increment: 1 }, nextTurnUserId: otherId, turnSince: new Date() },
      });
      if (!claimed.count) throw new ConflictException({ error: 'message_budget_exhausted' });
      await tx.agentMessage.create({ data: { negotiationId: neg.id, fromUserId: ctx.userId, toUserId: otherId, kind, content } });
      return tx.negotiation.findUniqueOrThrow({ where: { id: neg.id } });
    });
    await this.scheduleTurn(match.id, otherId);
    return { sent: true, messagesUsed: updated.messageCount, messagesLeft: this.maxMessages - updated.messageCount };
  }

  async getMessages(ctx: AgentContext, candidateId: string | undefined, unreadOnly: boolean) {
    const negotiations = candidateId
      ? [(await this.ensureOwned(ctx.userId, candidateId))]
      : await this.prisma.negotiation.findMany({
          where: {
            status: 'OPEN',
            match: { OR: [{ userAId: ctx.userId }, { userBId: ctx.userId }] },
            ...(unreadOnly ? { messages: { some: { toUserId: ctx.userId, readAt: null } } } : {}),
          },
          include: { match: true },
          take: 20,
        });
    const out = [];
    for (const neg of negotiations.filter(Boolean) as (Negotiation & { match: Match })[]) {
      const side = sideOf(neg.match, ctx.userId);
      const messages = await this.prisma.agentMessage.findMany({
        where: { negotiationId: neg.id, ...(unreadOnly ? { toUserId: ctx.userId, readAt: null } : {}) },
        orderBy: { createdAt: 'asc' },
      });
      await this.prisma.agentMessage.updateMany({ where: { negotiationId: neg.id, toUserId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
      out.push({
        candidateId: neg.matchId,
        status: neg.status,
        outcome: neg.outcome,
        messagesUsed: neg.messageCount,
        messagesLeft: Math.max(0, this.maxMessages - neg.messageCount),
        yourVerdict: side === 'A' ? neg.verdictA : neg.verdictB,
        counterpartHasGivenVerdict: !!(side === 'A' ? neg.verdictB : neg.verdictA),
        yourTurn: neg.nextTurnUserId === ctx.userId,
        messages: messages.map((m) =>
          m.fromUserId === ctx.userId
            ? { id: m.id, from: 'you', kind: m.kind, content: m.content, at: m.createdAt }
            : { id: m.id, from: 'counterpart_agent', kind: m.kind, untrusted: true, content: m.content, at: m.createdAt },
        ),
      });
    }
    return { notice: UNTRUSTED_NOTICE, negotiations: out };
  }

  private async ensureOwned(userId: string, candidateId: string) {
    const { match } = await this.load(userId, candidateId);
    if (!match.negotiation) return null;
    return { ...match.negotiation, match };
  }

  async submitVerdict(ctx: AgentContext, candidateId: string, verdict: string, rationale: string) {
    const filter = checkAgentMessage(rationale);
    if (filter.blocked) throw new SafetyBlockedError(filter.categories);
    const { match, side, otherId } = await this.load(ctx.userId, candidateId);
    const neg = await this.ensureNegotiation(match, ctx.userId);
    if (neg.status !== 'OPEN') throw new ConflictException({ error: 'negotiation_closed', message: 'This negotiation is already concluded' });
    const updated = await this.prisma.negotiation.update({
      where: { id: neg.id },
      data: side === 'A' ? { verdictA: verdict, rationaleA: rationale } : { verdictB: verdict, rationaleB: rationale },
    });
    const outcome = this.evaluate(updated);
    if (outcome) {
      await this.conclude(updated, outcome);
      return { recorded: verdict, negotiation: 'concluded', outcome };
    }
    const otherVerdict = side === 'A' ? updated.verdictB : updated.verdictA;
    // The counterpart acts next unless it already said match and we only asked to clarify with no budget left.
    await this.prisma.negotiation.update({ where: { id: neg.id }, data: { nextTurnUserId: otherId, turnSince: new Date() } });
    await this.scheduleTurn(match.id, otherId);
    return { recorded: verdict, negotiation: 'open', waitingFor: otherVerdict ? 'counterpart clarification' : 'counterpart verdict' };
  }

  /** match only if both say match; any no_match ends it; clarify with no budget left ends it. */
  evaluate(n: Pick<Negotiation, 'verdictA' | 'verdictB' | 'messageCount'>): 'match' | 'no_match' | null {
    if (n.verdictA === 'no_match' || n.verdictB === 'no_match') return 'no_match';
    if (n.verdictA === 'match' && n.verdictB === 'match') return 'match';
    if (n.verdictA && n.verdictB && n.messageCount >= this.maxMessages) return 'no_match';
    return null;
  }

  private async conclude(neg: Negotiation, outcome: 'match' | 'no_match') {
    await this.prisma.$transaction([
      this.prisma.negotiation.update({ where: { id: neg.id }, data: { status: 'CONCLUDED', outcome, concludedAt: new Date(), nextTurnUserId: null } }),
      this.prisma.match.update({ where: { id: neg.matchId }, data: { status: outcome === 'match' ? 'AGENT_MATCHED' : 'REJECTED' } }),
    ]);
    if (outcome === 'match') await this.queue.add('explain', { matchId: neg.matchId }, { jobId: `explain-${neg.matchId}`, removeOnComplete: 500, removeOnFail: 500 });
  }

  /** Owner-facing journal: every negotiation with the full transcript. */
  async journal(userId: string) {
    const negs = await this.prisma.negotiation.findMany({
      where: { match: { OR: [{ userAId: userId }, { userBId: userId }] } },
      include: { match: true, messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return negs.map((n) => {
      const side = sideOf(n.match, userId);
      return {
        candidateId: n.matchId,
        candidateLabel: `Candidate ${n.matchId.slice(-5).toUpperCase()}`,
        score: n.match.score,
        status: n.status,
        outcome: n.outcome,
        yourAgentVerdict: side === 'A' ? n.verdictA : n.verdictB,
        yourAgentRationale: side === 'A' ? n.rationaleA : n.rationaleB,
        theirAgentVerdict: n.status === 'CONCLUDED' ? (side === 'A' ? n.verdictB : n.verdictA) : undefined,
        messages: n.messages.map((m) => ({ from: m.fromUserId === userId ? 'your_agent' : 'their_agent', kind: m.kind, content: m.content, at: m.createdAt })),
        createdAt: n.createdAt,
        concludedAt: n.concludedAt,
      };
    });
  }
}
