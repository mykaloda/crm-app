import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AGENT_INSTRUCTIONS,
  AGENT_TOOLS,
  AgentToolName,
  FIELD_DEFS,
  SECTION_SCHEMAS,
  SectionKey,
  isAgentToolName,
  missingRequired,
  wordCount,
} from '@agentmatch/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { ConsentService } from '../common/consent.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { MatchingService } from '../matching/matching.service';
import { NegotiationService } from '../negotiation/negotiation.service';
import { ProfileService } from '../profile/profile.service';
import { AgentContext, changeSourceFor } from './agent-context';

const TOOL_CALLS_PER_HOUR = 600;

/** Field options from the zod section schemas, computed once. */
const FIELD_SPECS = (() => {
  const props: Record<string, unknown> = {};
  for (const s of Object.keys(SECTION_SCHEMAS) as SectionKey[]) {
    const js = z.toJSONSchema(SECTION_SCHEMAS[s], { unrepresentable: 'any' }) as { properties?: Record<string, unknown> };
    Object.assign(props, js.properties ?? {});
  }
  return props;
})();

function truncateForLog(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 30).map((v) => truncateForLog(v, depth + 1));
  if (value && typeof value === 'object' && depth < 4) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncateForLog(v, depth + 1)]));
  }
  return value;
}

function summarize(result: unknown): string {
  const s = JSON.stringify(result) ?? '';
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

/**
 * Single implementation of the agent tools, shared by MCP, Custom GPT (OpenAPI)
 * and the built-in agent. Every call is validated, rate-limited and logged.
 */
@Injectable()
export class AgentToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly consents: ConsentService,
    private readonly matching: MatchingService,
    private readonly negotiations: NegotiationService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async execute(ctx: AgentContext, tool: string, rawInput: unknown): Promise<unknown> {
    if (!isAgentToolName(tool)) throw new BadRequestException({ error: 'unknown_tool', message: `Unknown tool ${tool}` });
    const parsed = AGENT_TOOLS[tool].input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      await this.log(ctx, tool, rawInput, 'error', 'invalid_input');
      throw new BadRequestException({ error: 'invalid_input', issues });
    }
    try {
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
      if (!user.aiEnabled) throw new ForbiddenException({ error: 'ai_disabled', message: 'The user has turned off AI access' });
      if (user.ageVerificationStatus !== 'VERIFIED') throw new ForbiddenException({ error: 'age_verification_required' });
      if (!(await this.consents.has(ctx.userId, 'AI_PROCESSING'))) throw new ForbiddenException({ error: 'ai_consent_required' });
      await this.rateLimit.consume(`agent:${ctx.userId}`, TOOL_CALLS_PER_HOUR, 3600, 'agent tool calls');
      const result = await this.run(ctx, tool, parsed.data as never);
      await this.log(ctx, tool, parsed.data, 'ok', undefined, summarize(result));
      return result;
    } catch (e) {
      const body = e instanceof HttpException ? (e.getResponse() as { error?: string; message?: string }) : undefined;
      const status = e instanceof HttpException && e.getStatus() === 429 ? 'rate_limited' : body?.error === 'blocked_by_safety_filter' ? 'blocked' : 'error';
      await this.log(ctx, tool, parsed.data, status, body?.error ?? (e as Error).message);
      throw e;
    }
  }

  private async run<N extends AgentToolName>(ctx: AgentContext, tool: N, input: Record<string, never>): Promise<unknown> {
    const i = input as Record<string, unknown>;
    switch (tool) {
      case 'get_profile_schema':
        return this.profileSchema(ctx.userId);
      case 'update_profile': {
        const r = await this.profiles.createDraft(ctx.userId, i.changes as never, changeSourceFor(ctx.connectionType), {
          connectionId: ctx.connectionId,
          note: i.note as string | undefined,
        });
        return {
          ...r,
          message:
            'Saved as a draft. Ask your user to review and approve it on the website (Profile → Review).' +
            (r.droppedFields.length ? ` Dropped sensitive fields without consent: ${r.droppedFields.join(', ')}.` : ''),
        };
      }
      case 'search_candidates':
        await this.rateLimit.consume(`search:${ctx.userId}`, this.config.RATE_LIMIT_SEARCH_PER_HOUR, 3600, 'search_candidates');
        return this.matching.searchForAgent(ctx.userId, i.limit as number);
      case 'get_candidate_card':
        return this.matching.candidateCard(ctx.userId, i.candidateId as string);
      case 'send_agent_message':
        await this.rateLimit.consume(`msg:${ctx.userId}`, this.config.RATE_LIMIT_AGENT_MESSAGES_PER_HOUR, 3600, 'send_agent_message');
        return this.negotiations.sendMessage(ctx, i.candidateId as string, i.kind as string, i.content as string);
      case 'get_agent_messages':
        return this.negotiations.getMessages(ctx, i.candidateId as string | undefined, i.unreadOnly as boolean);
      case 'propose_match':
        return this.negotiations.submitVerdict(ctx, i.candidateId as string, i.verdict as string, i.rationale as string);
      case 'get_matches':
        return this.matching.listMatchesForAgent(ctx.userId, i.status as string);
    }
  }

  async profileSchema(userId: string) {
    const [{ data, visibility, row }, drafts, sensitiveConsent] = await Promise.all([
      this.profiles.load(userId),
      this.profiles.listDrafts(userId),
      this.consents.has(userId, 'SENSITIVE_DATA'),
    ]);
    // The user's own agent sees their profile, except fields they marked hidden.
    const own: Record<string, Record<string, unknown>> = {};
    for (const f of FIELD_DEFS) {
      const v = (data[f.section] as Record<string, unknown> | undefined)?.[f.key];
      if (v === undefined || visibility[f.key] === 'hidden') continue;
      (own[f.section] ??= {})[f.key] = v;
    }
    return {
      instructions: AGENT_INSTRUCTIONS,
      rules: {
        drafts: 'update_profile creates drafts; the human approves them on the website.',
        sensitiveData: sensitiveConsent
          ? 'The user consented to processing faith and politics. Still ask before recording them.'
          : 'The user has NOT consented to sensitive data: do not ask about or record faith or politics.',
        description: 'aiDescription: 150-300 words, third person, no surname/contacts/exact location.',
      },
      fields: FIELD_DEFS.filter((f) => sensitiveConsent || !f.sensitive).map((f) => ({
        key: f.key,
        section: f.section,
        filter: f.filter,
        required: !!f.required,
        sensitive: !!f.sensitive,
        visibility: visibility[f.key],
        hint: f.hint,
        schema: FIELD_SPECS[f.key],
      })),
      profile: {
        status: row?.status ?? 'INCOMPLETE',
        completeness: row?.completeness ?? 0,
        missingRequired: missingRequired(data),
        descriptionWords: wordCount(data.description?.aiDescription),
        data: own,
      },
      pendingDrafts: drafts.map((d) => ({ id: d.id, createdAt: d.createdAt, note: d.note, sections: Object.keys(d.patch) })),
    };
  }

  private async log(ctx: AgentContext, tool: string, input: unknown, status: string, reason?: string, resultSummary?: string) {
    await this.prisma.agentActionLog
      .create({
        data: {
          userId: ctx.userId,
          connectionId: ctx.connectionId,
          tool,
          input: (truncateForLog(input) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          status,
          reason: reason?.slice(0, 300),
          resultSummary,
        },
      })
      .catch(() => undefined);
  }
}
