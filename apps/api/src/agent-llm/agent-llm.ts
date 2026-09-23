import { AgentMessageKind, ProfileData, ScoreBreakdown, Verdict } from '@agentmatch/shared';

export interface ChatTurn {
  role: 'assistant' | 'user';
  content: string;
}

export interface InterviewInput {
  history: ChatTurn[];
  /** Fields collected so far in this interview (not yet approved). */
  collected: ProfileData;
  /** The approved profile, for context. */
  current: ProfileData;
  sensitiveConsent: boolean;
  /** Validation problems with the previous patch, if any. */
  lastErrors?: string[];
  /** Opaque interviewer state (used by the scripted interviewer). */
  state: Record<string, unknown>;
  locale: string;
}

export interface InterviewOutput {
  reply: string;
  patch?: ProfileData;
  done: boolean;
  state: Record<string, unknown>;
}

export interface TranscriptEntry {
  from: 'you' | 'counterpart';
  kind: string;
  content: string;
}

export interface NegotiationInput {
  /** What the owner allows agents to see about themselves (safe to share). */
  ownShareable: ProfileData;
  /** Anonymised candidate card. */
  candidate: Record<string, unknown>;
  scoreForOwner: ScoreBreakdown | null;
  pairScore: number;
  transcript: TranscriptEntry[];
  messagesUsed: number;
  maxMessages: number;
  ownVerdict: string | null;
  counterpartHasVerdict: boolean;
}

export type NegotiationDecision =
  | { action: 'message'; kind: AgentMessageKind; content: string }
  | { action: 'verdict'; verdict: Verdict; rationale: string };

export interface ExplainInput {
  candidate: Record<string, unknown>;
  scoreForOwner: ScoreBreakdown | null;
  pairScore: number;
  ownRationale: string | null;
  locale: string;
}

/** The built-in agent's brain. Implemented by Anthropic (Claude) or a scripted offline fallback. */
export interface AgentLLM {
  readonly name: string;
  interviewTurn(input: InterviewInput): Promise<InterviewOutput>;
  negotiationTurn(input: NegotiationInput): Promise<NegotiationDecision>;
  explainMatch(input: ExplainInput): Promise<string>;
}

export const AGENT_LLM = Symbol('AGENT_LLM');
