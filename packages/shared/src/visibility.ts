import { z } from 'zod';

/**
 * Who may see a profile field.
 * - hidden: stored, never used or shown
 * - algorithm_only: used by filters/scoring, never shown to any agent or person
 * - agents: visible to the counterpart's AI agent during negotiation (anonymised card)
 * - people: visible to the other person once both have expressed interest
 */
export const VISIBILITY_LEVELS = ['hidden', 'algorithm_only', 'agents', 'people'] as const;
export type Visibility = (typeof VISIBILITY_LEVELS)[number];
export const visibilitySchema = z.enum(VISIBILITY_LEVELS);

const RANK: Record<Visibility, number> = { hidden: 0, algorithm_only: 1, agents: 2, people: 3 };

export function visibilityRank(v: Visibility): number {
  return RANK[v];
}

/** True when a field with visibility `v` may be shown to `audience`. */
export function isVisibleTo(v: Visibility, audience: 'algorithm' | 'agents' | 'people'): boolean {
  const need = audience === 'algorithm' ? 1 : audience === 'agents' ? 2 : 3;
  return RANK[v] >= need;
}

export function clampVisibility(v: Visibility, min: Visibility, max: Visibility): Visibility {
  const r = Math.min(Math.max(RANK[v], RANK[min]), RANK[max]);
  return VISIBILITY_LEVELS[r];
}
