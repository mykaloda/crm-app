import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProfileData, checkProfileText, mergeProfile, profilePatchSchema } from '@agentmatch/shared';
import { ConsentService } from '../common/consent.service';
import { PrismaService } from '../common/prisma.service';
import { AGENT_LLM, AgentLLM, ChatTurn } from '../agent-llm/agent-llm';
import { AgentToolsService } from '../agent-tools/agent-tools.service';
import { BuiltinAgentService } from '../negotiation/builtin-agent.service';
import { ProfileService } from '../profile/profile.service';

interface InterviewState {
  collected?: ProfileData;
  lastErrors?: string[];
  [k: string]: unknown;
}

/** Onboarding interview run by the built-in agent. The result is saved as a profile draft. */
@Injectable()
export class InterviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentService,
    private readonly profiles: ProfileService,
    private readonly tools: AgentToolsService,
    private readonly builtin: BuiltinAgentService,
    @Inject(AGENT_LLM) private readonly llm: AgentLLM,
  ) {}

  private async assertAllowed(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.ageVerificationStatus !== 'VERIFIED') throw new ForbiddenException({ error: 'age_verification_required' });
    if (!user.aiEnabled) throw new ForbiddenException({ error: 'ai_disabled' });
    if (!(await this.consents.has(userId, 'AI_PROCESSING'))) throw new ForbiddenException({ error: 'ai_consent_required' });
    return user;
  }

  private view(s: { id: string; status: string; messages: Prisma.JsonValue; state: Prisma.JsonValue }, extra: Record<string, unknown> = {}) {
    const state = (s.state ?? {}) as InterviewState;
    return {
      sessionId: s.id,
      status: s.status,
      messages: s.messages as unknown as ChatTurn[],
      collectedSections: Object.keys(state.collected ?? {}),
      ...extra,
    };
  }

  async current(userId: string) {
    const s = await this.prisma.interviewSession.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return s ? this.view(s) : null;
  }

  async start(userId: string) {
    const user = await this.assertAllowed(userId);
    const existing = await this.prisma.interviewSession.findFirst({ where: { userId, status: 'active' }, orderBy: { createdAt: 'desc' } });
    if (existing) return this.view(existing);
    await this.builtin.builtinContext(userId);
    const { data } = await this.profiles.load(userId);
    const out = await this.llm.interviewTurn({
      history: [],
      collected: {},
      current: data,
      sensitiveConsent: await this.consents.has(userId, 'SENSITIVE_DATA'),
      state: {},
      locale: user.locale,
    });
    const s = await this.prisma.interviewSession.create({
      data: {
        userId,
        messages: [{ role: 'assistant', content: out.reply }] as unknown as Prisma.InputJsonValue,
        state: { ...out.state, collected: {} } as Prisma.InputJsonValue,
      },
    });
    return this.view(s);
  }

  async message(userId: string, sessionId: string, content: string) {
    const user = await this.assertAllowed(userId);
    const s = await this.prisma.interviewSession.findFirst({ where: { id: sessionId, userId } });
    if (!s) throw new NotFoundException();
    if (s.status !== 'active') throw new ConflictException({ error: 'interview_completed' });
    const history = [...(s.messages as unknown as ChatTurn[]), { role: 'user' as const, content: content.slice(0, 4000) }];
    const state = (s.state ?? {}) as InterviewState;
    const { data } = await this.profiles.load(userId);
    const out = await this.llm.interviewTurn({
      history,
      collected: state.collected ?? {},
      current: data,
      sensitiveConsent: await this.consents.has(userId, 'SENSITIVE_DATA'),
      lastErrors: state.lastErrors,
      state,
      locale: user.locale,
    });

    let collected = state.collected ?? {};
    const errors: string[] = [];
    if (out.patch) {
      const parsed = profilePatchSchema.safeParse(out.patch);
      if (!parsed.success) errors.push(...parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
      else {
        const texts = [parsed.data.description?.aiDescription, parsed.data.interests?.interestsText].filter(Boolean) as string[];
        const bad = texts.map(checkProfileText).find((r) => r.blocked);
        if (bad) errors.push(`text must not contain ${bad.categories.join(', ')}`);
        else collected = mergeProfile(collected, parsed.data);
      }
    }
    history.push({ role: 'assistant', content: out.reply });
    let draftId: string | undefined;
    let status = 'active';
    if (out.done) {
      draftId = await this.saveDraft(userId, collected);
      status = 'completed';
    }
    const updated = await this.prisma.interviewSession.update({
      where: { id: s.id },
      data: {
        messages: history as unknown as Prisma.InputJsonValue,
        state: { ...out.state, collected, lastErrors: errors } as Prisma.InputJsonValue,
        status,
      },
    });
    return this.view(updated, { reply: out.reply, done: out.done, draftId });
  }

  /** Finish early and save whatever was collected. */
  async finish(userId: string, sessionId: string) {
    const s = await this.prisma.interviewSession.findFirst({ where: { id: sessionId, userId, status: 'active' } });
    if (!s) throw new NotFoundException();
    const draftId = await this.saveDraft(userId, ((s.state ?? {}) as InterviewState).collected ?? {});
    const updated = await this.prisma.interviewSession.update({ where: { id: s.id }, data: { status: 'completed' } });
    return this.view(updated, { draftId });
  }

  private async saveDraft(userId: string, collected: ProfileData): Promise<string | undefined> {
    if (!Object.keys(collected).length) return undefined;
    const ctx = await this.builtin.builtinContext(userId);
    const r = (await this.tools.execute(ctx, 'update_profile', { changes: collected, note: 'From the onboarding interview' })) as { draftId: string };
    return r.draftId;
  }
}
