import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ProfileData, ScoreBreakdown, redactProfile } from '@agentmatch/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { AGENT_LLM, AgentLLM, NegotiationDecision } from '../agent-llm/agent-llm';
import { AgentContext } from '../agent-tools/agent-context';
import { AgentToolsService } from '../agent-tools/agent-tools.service';
import { MatchingService, sideOf } from '../matching/matching.service';
import { rowToProfileData, rowVisibility } from '../profile/profile.mapper';
import { NegotiationService } from './negotiation.service';

export type TurnResult = 'acted' | 'not_your_turn' | 'concluded' | 'waiting_for_external_agent' | 'ai_disabled';

/** Runs the built-in agent for users without their own AI (or whose AI did not answer in time). */
@Injectable()
export class BuiltinAgentService {
  private readonly log = new Logger(BuiltinAgentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly tools: AgentToolsService,
    private readonly matching: MatchingService,
    private readonly negotiations: NegotiationService,
    @Inject(AGENT_LLM) private readonly llm: AgentLLM,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async builtinContext(userId: string): Promise<AgentContext> {
    const conn =
      (await this.prisma.agentConnection.findFirst({ where: { userId, type: 'BUILTIN', revokedAt: null } })) ??
      (await this.prisma.agentConnection.create({ data: { userId, type: 'BUILTIN', label: 'Built-in agent' } }));
    return { userId, connectionId: conn.id, connectionType: 'BUILTIN' };
  }

  /** ms until the built-in agent may act for this user (0 = now). */
  async graceRemainingMs(userId: string, since: Date | null): Promise<number> {
    const recentExternal = await this.prisma.agentConnection.count({
      where: {
        userId,
        type: { in: ['MCP', 'CUSTOM_GPT'] },
        revokedAt: null,
        lastUsedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
    });
    if (!recentExternal) return 0;
    const due = (since?.getTime() ?? Date.now()) + this.config.NEGOTIATION_EXTERNAL_GRACE_HOURS * 3_600_000;
    return Math.max(0, due - Date.now());
  }

  private shareable(data: ProfileData, row: Parameters<typeof rowVisibility>[0]): ProfileData {
    const visible = redactProfile(data, rowVisibility(row), 'agents');
    if (visible.basic) {
      const { displayName: _n, birthDate: _b, lat: _la, lng: _ln, ...rest } = visible.basic;
      visible.basic = rest;
    }
    return visible;
  }

  async takeTurn(matchId: string, userId: string, opts: { ignoreGrace?: boolean } = {}): Promise<TurnResult> {
    const neg = await this.prisma.negotiation.findUnique({ where: { matchId }, include: { match: true, messages: { orderBy: { createdAt: 'asc' } } } });
    if (!neg || neg.status !== 'OPEN') return 'concluded';
    if (neg.nextTurnUserId !== userId) return 'not_your_turn';
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.aiEnabled || user.status !== 'ACTIVE') return 'ai_disabled';
    if (!opts.ignoreGrace) {
      const wait = await this.graceRemainingMs(userId, neg.turnSince);
      if (wait > 0) {
        await this.negotiations.scheduleTurn(matchId, userId, wait);
        return 'waiting_for_external_agent';
      }
    }
    const ctx = await this.builtinContext(userId);
    const side = sideOf(neg.match, userId);
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    const card = await this.matching.candidateCard(userId, matchId);
    const ownVerdict = side === 'A' ? neg.verdictA : neg.verdictB;
    const input = {
      ownShareable: this.shareable(rowToProfileData(row, this.crypto), row),
      candidate: card.card as Record<string, unknown>,
      scoreForOwner: card.scoreBreakdownForYou as ScoreBreakdown | null,
      pairScore: neg.match.score,
      transcript: neg.messages.map((m) => ({ from: m.fromUserId === userId ? ('you' as const) : ('counterpart' as const), kind: m.kind, content: m.content })),
      messagesUsed: neg.messageCount,
      maxMessages: this.negotiations.maxMessages,
      ownVerdict,
      counterpartHasVerdict: !!(side === 'A' ? neg.verdictB : neg.verdictA),
    };

    let decision: NegotiationDecision;
    try {
      decision = await this.llm.negotiationTurn(input);
    } catch (e) {
      this.log.warn(`LLM turn failed for ${matchId}: ${(e as Error).message}`);
      decision = this.fallbackVerdict(neg.match.score, 'The agent could not complete the conversation; decided on compatibility score.');
    }
    // Out of budget, or already said match and the other side has spoken: settle with a verdict.
    if (decision.action === 'message' && neg.messageCount >= this.negotiations.maxMessages) {
      decision = this.fallbackVerdict(neg.match.score, 'Message budget used; decided on compatibility score.');
    }
    try {
      await this.execute(ctx, matchId, decision);
    } catch (e) {
      const body = e instanceof HttpException ? (e.getResponse() as { error?: string }) : undefined;
      if (decision.action === 'message' && (body?.error === 'blocked_by_safety_filter' || body?.error === 'message_budget_exhausted')) {
        await this.execute(ctx, matchId, this.fallbackVerdict(neg.match.score, 'Decided on compatibility score.'));
      } else {
        throw e;
      }
    }
    return 'acted';
  }

  private fallbackVerdict(score: number, note: string): NegotiationDecision {
    return { action: 'verdict', verdict: score >= 60 ? 'match' : 'no_match', rationale: `${note} Score ${Math.round(score)}/100.` };
  }

  private async execute(ctx: AgentContext, matchId: string, d: NegotiationDecision) {
    if (d.action === 'message') {
      await this.tools.execute(ctx, 'send_agent_message', { candidateId: matchId, kind: d.kind, content: d.content });
    } else {
      await this.tools.execute(ctx, 'propose_match', { candidateId: matchId, verdict: d.verdict, rationale: d.rationale });
    }
  }

  /** Drive a negotiation between built-in agents to the end (tests, seed, admin tools). */
  async runToCompletion(matchId: string, maxTurns = 30): Promise<string | null> {
    for (let i = 0; i < maxTurns; i++) {
      const neg = await this.prisma.negotiation.findUnique({ where: { matchId } });
      if (!neg || neg.status !== 'OPEN' || !neg.nextTurnUserId) break;
      const r = await this.takeTurn(matchId, neg.nextTurnUserId, { ignoreGrace: true });
      if (r !== 'acted') break;
    }
    await this.explain(matchId);
    return (await this.prisma.negotiation.findUnique({ where: { matchId } }))?.outcome ?? null;
  }

  /** Human-readable explanation per side once both agents agreed. */
  async explain(matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { negotiation: true, userA: true, userB: true } });
    if (!match || match.status !== 'AGENT_MATCHED' || (match.explanationA && match.explanationB)) return;
    const texts: Record<'A' | 'B', string> = { A: '', B: '' };
    for (const side of ['A', 'B'] as const) {
      const user = side === 'A' ? match.userA : match.userB;
      const card = await this.matching.candidateCard(user.id, matchId);
      try {
        texts[side] = await this.llm.explainMatch({
          candidate: card.card as Record<string, unknown>,
          scoreForOwner: card.scoreBreakdownForYou as ScoreBreakdown | null,
          pairScore: match.score,
          ownRationale: (side === 'A' ? match.negotiation?.rationaleA : match.negotiation?.rationaleB) ?? null,
          locale: user.locale,
        });
      } catch (e) {
        this.log.warn(`explain failed: ${(e as Error).message}`);
        texts[side] = `Both agents recommend this match (compatibility ${Math.round(match.score)}/100).`;
      }
    }
    await this.prisma.match.update({ where: { id: matchId }, data: { explanationA: texts.A, explanationB: texts.B } });
  }
}
