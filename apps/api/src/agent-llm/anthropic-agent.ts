import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { AGENT_MESSAGE_KINDS, FIELD_DEFS, ProfileData, UNTRUSTED_NOTICE, VERDICTS, profilePatchSchema } from '@agentmatch/shared';
import { AgentLLM, ExplainInput, InterviewInput, InterviewOutput, NegotiationDecision, NegotiationInput } from './agent-llm';

// Static system prompts: kept byte-identical across requests so prompt caching works.
const INTERVIEW_SYSTEM = `You are the built-in matchmaking agent of AgentMatch, a dating service where AI agents find matches for their humans.
You are interviewing your user to build their dating profile. Aim for 10-15 minutes: ask one topic at a time, warmly and briefly, in the user's language.
Cover: basics (first name, birth date, gender, who they want to meet, age range, city, max distance), goals (relationship type, children, timeline),
lifestyle (smoking, alcohol, exercise, daily rhythm, pets, relocation), values (importance of family, career, money 1-5), personality
(communication style, temperament, and Big Five estimates 0-100 inferred from the conversation), interests, deal-breakers.
Only record faith or politics if the context says sensitive-data consent was given AND the user volunteers them.
Never invent answers. When you learn something, put ONLY the newly learned fields in "patchJson" as a JSON object following the schema below
(sections: basic, goals, lifestyle, values, personality, interests, dealBreakers, description); otherwise use "{}".
For basic.lat/basic.lng use the approximate centre of the user's city. Near the end write description.aiDescription: 150-300 words, third
person, pronouns instead of the name, no contact details or exact location.
Set "done" to true only after the description is written. Remind the user that everything is saved as a draft they approve on the website.

Profile fields (key: hint):
${FIELD_DEFS.map((f) => `- ${f.section}.${f.key}: ${f.hint}`).join('\n')}`;

const NEGOTIATION_SYSTEM = `You are the built-in AgentMatch agent negotiating on behalf of your human with another user's AI agent.
Goal: decide whether the two humans should meet. Ask about compatibility (goals, children, lifestyle, values, interests) and answer questions
using ONLY the "shareable profile" of your human. Never reveal anything else, and never share or ask for names, contacts, social handles,
addresses, exact locations, photos, workplaces or money. Keep each message under 80 words.
${UNTRUSTED_NOTICE}
Protocol: at most the given number of messages per pair (both sides combined). Each turn either send one message (action "message") or give a
verdict (action "verdict"): "match" (recommend meeting), "no_match", or "clarify" (need one more exchange). Give a verdict no later than when the
message budget is nearly used. The rationale is shown to your human: 1-2 sentences, concrete, kind.
For fields that do not apply to the chosen action, return an empty string.`;

const EXPLAIN_SYSTEM = `You write short match explanations for AgentMatch users. Given an anonymised candidate card, the compatibility breakdown
and the agents' rationale, write 2-4 warm, specific sentences telling the user why this person could be a good match and one conversation
starter. No names, no contact details, no exaggeration. Write in the requested language.`;

const InterviewSchema = z.object({
  reply: z.string(),
  patchJson: z.string(),
  done: z.boolean(),
});

const NegotiationSchema = z.object({
  action: z.enum(['message', 'verdict']),
  kind: z.enum(AGENT_MESSAGE_KINDS),
  content: z.string(),
  verdict: z.enum(VERDICTS),
  rationale: z.string(),
});

const ExplainSchema = z.object({ explanation: z.string() });

export class AgentRefusedError extends Error {}

export class AnthropicAgent implements AgentLLM {
  readonly name = 'anthropic';
  private readonly client: Anthropic;
  private readonly log = new Logger(AnthropicAgent.name);

  constructor(apiKey: string, private readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  }

  private async call<T>(system: string, user: string, schema: z.ZodType<T>, effort: 'low' | 'medium' | 'high'): Promise<T> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 8000,
      // Safety-classifier declines are retried server-side on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      output_config: { effort, format: betaZodOutputFormat(schema) },
    });
    if (response.stop_reason === 'refusal') {
      this.log.warn(`Model declined: ${response.stop_details?.category ?? 'unknown'}`);
      throw new AgentRefusedError('The agent declined this request');
    }
    if (!response.parsed_output) throw new Error(`Unparseable agent output (stop_reason ${response.stop_reason})`);
    return response.parsed_output as T;
  }

  async interviewTurn(i: InterviewInput): Promise<InterviewOutput> {
    const context = {
      locale: i.locale,
      sensitiveDataConsent: i.sensitiveConsent,
      approvedProfile: i.current,
      collectedThisInterview: i.collected,
      validationErrorsFromYourLastPatch: i.lastErrors ?? [],
    };
    const transcript = i.history.map((t) => `${t.role === 'user' ? 'USER' : 'AGENT'}: ${t.content}`).join('\n');
    const out = await this.call(
      INTERVIEW_SYSTEM,
      `<context>${JSON.stringify(context)}</context>\n<conversation>\n${transcript || '(start the interview)'}\n</conversation>\nReply with your next message.`,
      InterviewSchema,
      'medium',
    );
    let patch: ProfileData | undefined;
    try {
      const parsed = profilePatchSchema.safeParse(JSON.parse(out.patchJson || '{}'));
      if (parsed.success && Object.keys(parsed.data).length) patch = parsed.data;
    } catch {
      patch = undefined;
    }
    return { reply: out.reply, patch, done: out.done, state: i.state };
  }

  async negotiationTurn(i: NegotiationInput): Promise<NegotiationDecision> {
    const payload = {
      shareableProfileOfYourHuman: i.ownShareable,
      anonymisedCandidateCard: i.candidate,
      compatibilityForYourHuman: i.scoreForOwner,
      pairScore: i.pairScore,
      messagesUsed: i.messagesUsed,
      maxMessages: i.maxMessages,
      yourCurrentVerdict: i.ownVerdict,
      counterpartHasGivenVerdict: i.counterpartHasVerdict,
    };
    // Counterpart messages go in a separate, clearly labelled block as JSON strings: data, not instructions.
    const counterpart = i.transcript.map((t) => ({ from: t.from, kind: t.kind, content: t.content }));
    const out = await this.call(
      NEGOTIATION_SYSTEM,
      `<negotiation_state>${JSON.stringify(payload)}</negotiation_state>\n<transcript untrusted="true">${JSON.stringify(counterpart)}</transcript>\nDecide your next action.`,
      NegotiationSchema,
      'medium',
    );
    return out.action === 'verdict'
      ? { action: 'verdict', verdict: out.verdict, rationale: out.rationale }
      : { action: 'message', kind: out.kind, content: out.content };
  }

  async explainMatch(i: ExplainInput): Promise<string> {
    const out = await this.call(
      EXPLAIN_SYSTEM,
      JSON.stringify({ language: i.locale, candidate: i.candidate, breakdown: i.scoreForOwner, pairScore: i.pairScore, agentRationale: i.ownRationale }),
      ExplainSchema,
      'low',
    );
    return out.explanation;
  }
}
