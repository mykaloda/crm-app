import { AlgorithmWeights, ScoreBreakdown } from '@agentmatch/shared';
import { relationshipCompat } from './filters';
import { MatchProfile } from './match-profile';

const NEUTRAL = 0.5;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NEUTRAL);

function weightedAvg(pairs: [number, number][]): number | null {
  const w = pairs.reduce((s, [, wt]) => s + wt, 0);
  return w > 0 ? pairs.reduce((s, [v, wt]) => s + v * wt, 0) / w : null;
}

function ordinal(order: readonly string[], a?: string, b?: string): number | null {
  if (!a || !b) return null;
  const i = order.indexOf(a);
  const j = order.indexOf(b);
  if (i < 0 || j < 0) return null;
  return 1 - Math.abs(i - j) / (order.length - 1);
}

// ---------------- goals & values ----------------
const TIMELINE = ['asap', 'within_1y', 'within_3y', 'no_rush'] as const;
const POLITICS_AXIS: Record<string, number> = { left: 0, center_left: 1, center: 2, center_right: 3, right: 4 };

function childrenCompat(a: string, b: string): number {
  if (a === b) return a === 'maybe' ? 0.8 : 1;
  if (a === 'maybe' || b === 'maybe') return 0.6;
  return 0;
}

function faithCompat(a: string, b: string): number {
  if (a === b) return 1;
  const secular = (f: string) => f === 'none' || f === 'spiritual';
  if (secular(a) && secular(b)) return 0.7;
  if (a === 'spiritual' || b === 'spiritual') return 0.5;
  return 0.15;
}

function politicsCompat(a: string, b: string): number {
  if (a === 'apolitical' || b === 'apolitical') return a === b ? 1 : 0.6;
  return 1 - Math.abs(POLITICS_AXIS[a] - POLITICS_AXIS[b]) / 4;
}

/** How well B's goals and values fit A. A's importance ratings weight the value dimensions. */
export function goalsValuesScore(a: MatchProfile, b: MatchProfile): number {
  const goals = avg([
    relationshipCompat(a.relationshipType, b.relationshipType),
    childrenCompat(a.wantsChildren, b.wantsChildren),
    ordinal(TIMELINE, a.timeline, b.timeline) ?? NEUTRAL,
  ]);
  const va = a.values;
  const vb = b.values;
  if (!va || !vb) return goals;
  const pairs: [number, number][] = [];
  for (const k of ['family', 'career', 'money'] as const) {
    if (va[k] && vb[k]) pairs.push([1 - Math.abs(va[k]! - vb[k]!) / 4, 0.5 + va[k]! / 5]);
  }
  if (va.faith && vb.faith) pairs.push([faithCompat(va.faith, vb.faith), ((va.faithImportance ?? 3) / 5) * 2]);
  if (va.politics && vb.politics) pairs.push([politicsCompat(va.politics, vb.politics), ((va.politicsImportance ?? 3) / 5) * 2]);
  const values = weightedAvg(pairs);
  return values === null ? goals : 0.6 * goals + 0.4 * values;
}

// ---------------- lifestyle ----------------
const FREQ = ['never', 'socially', 'regularly'] as const;
const EXERCISE = ['never', 'sometimes', 'often', 'daily'] as const;
const RELOC = ['no', 'maybe', 'yes'] as const;

function scheduleCompat(a: string, b: string): number {
  if (a === b) return 1;
  if (a === 'flexible' || b === 'flexible') return 0.8;
  if (a === 'shift_work' || b === 'shift_work') return 0.5;
  return 0.3; // early_bird vs night_owl
}

function petsCompat(a: string, b: string): number {
  if (a === b) return 1;
  const hasPet = (p: string) => p === 'dog' || p === 'cat' || p === 'other';
  if ((a === 'allergic' && hasPet(b)) || (b === 'allergic' && hasPet(a))) return 0;
  if (a === 'none' || b === 'none' || a === 'allergic' || b === 'allergic') return 0.7;
  return 0.7; // different pets
}

export function lifestyleScore(a: MatchProfile, b: MatchProfile): number {
  const la = a.lifestyle;
  const lb = b.lifestyle;
  const parts = [
    ordinal(FREQ, la.smoking, lb.smoking),
    ordinal(FREQ, la.alcohol, lb.alcohol),
    ordinal(EXERCISE, la.exercise, lb.exercise),
    la.schedule && lb.schedule ? scheduleCompat(la.schedule, lb.schedule) : null,
    la.pets && lb.pets ? petsCompat(la.pets, lb.pets) : null,
    ordinal(RELOC, la.relocation, lb.relocation),
  ].filter((x): x is number => x !== null);
  return avg(parts);
}

// ---------------- personality ----------------
function styleCompat(a: string, b: string): number {
  if (a === b) return 1;
  const pair = [a, b].sort().join('+');
  if (pair === 'diplomatic+direct') return 0.6;
  if (pair === 'playful+reserved') return 0.5;
  return 0.75;
}

const TEMPER = ['calm', 'balanced', 'energetic'] as const;

/** Similarity on most traits, tolerance on extraversion, and A prefers emotionally stable partners. */
export function personalityScore(a: MatchProfile, b: MatchProfile): number {
  const pa = a.personality;
  const pb = b.personality;
  if (!pa || !pb) return NEUTRAL;
  const parts: number[] = [];
  const sim = (x?: number, y?: number, span = 100) => (x === undefined || y === undefined ? null : clamp01(1 - Math.abs(x - y) / span));
  for (const v of [
    sim(pa.openness, pb.openness),
    sim(pa.conscientiousness, pb.conscientiousness),
    sim(pa.agreeableness, pb.agreeableness),
    sim(pa.extraversion, pb.extraversion, 150),
    pb.neuroticism === undefined ? null : 1 - pb.neuroticism / 200,
    pa.communicationStyle && pb.communicationStyle ? styleCompat(pa.communicationStyle, pb.communicationStyle) : null,
    ordinal(TEMPER, pa.temperament, pb.temperament),
  ]) {
    if (v !== null) parts.push(v);
  }
  return avg(parts);
}

// ---------------- interests ----------------
/** Share of A's interests B covers, blended with Jaccard and semantic similarity of descriptions. */
export function interestsScore(a: MatchProfile, b: MatchProfile, cosine?: number | null): number {
  const A = new Set(a.interestTags);
  const B = new Set(b.interestTags);
  let tags: number | null = null;
  if (A.size && B.size) {
    const overlap = [...A].filter((t) => B.has(t)).length;
    const coverage = Math.min(1, overlap / Math.min(A.size, 5));
    const jaccard = overlap / new Set([...A, ...B]).size;
    tags = 0.7 * coverage + 0.3 * jaccard;
  }
  const semantic = cosine === undefined || cosine === null ? null : clamp01(cosine / 0.5);
  if (tags === null && semantic === null) return NEUTRAL;
  if (tags === null) return semantic!;
  if (semantic === null) return tags;
  return 0.6 * tags + 0.4 * semantic;
}

// ---------------- activity & completeness ----------------
export function activityScore(b: MatchProfile, now: Date = new Date()): number {
  const completeness = clamp01(b.completeness / 100);
  let recency = 0.1;
  if (b.lastActiveAt) {
    const days = (now.getTime() - b.lastActiveAt.getTime()) / 86_400_000;
    recency = days <= 1 ? 1 : days <= 7 ? 0.8 : days <= 30 ? 0.4 : 0.1;
  }
  return 0.5 * completeness + 0.5 * recency;
}

/** Directional score A→B (how well B fits A), 0-100. */
export function scoreDirectional(
  a: MatchProfile,
  b: MatchProfile,
  weights: AlgorithmWeights,
  opts: { cosine?: number | null; now?: Date } = {},
): ScoreBreakdown {
  const parts = {
    goalsValues: goalsValuesScore(a, b),
    lifestyle: lifestyleScore(a, b),
    personality: personalityScore(a, b),
    interests: interestsScore(a, b, opts.cosine),
    activity: activityScore(b, opts.now),
  };
  const wSum = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
  const total = (Object.keys(parts) as (keyof typeof parts)[]).reduce((s, k) => s + parts[k] * weights[k], 0) / wSum;
  const pct = (x: number) => Math.round(x * 1000) / 10;
  return {
    goalsValues: pct(parts.goalsValues),
    lifestyle: pct(parts.lifestyle),
    personality: pct(parts.personality),
    interests: pct(parts.interests),
    activity: pct(parts.activity),
    total: pct(total),
  };
}

/** Final pair score = min of both directions, so both people must fit each other. */
export function scorePair(a: MatchProfile, b: MatchProfile, weights: AlgorithmWeights, opts: { cosine?: number | null; now?: Date } = {}) {
  const ab = scoreDirectional(a, b, weights, opts);
  const ba = scoreDirectional(b, a, weights, opts);
  return { ab, ba, score: Math.min(ab.total, ba.total) };
}
