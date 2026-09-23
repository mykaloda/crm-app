import { MatchProfile } from './match-profile';

/** Relationship-goal compatibility (symmetric). Pairs below HARD_GOAL_MIN are filtered out. */
const REL: Record<string, Record<string, number>> = {
  long_term: { long_term: 1, marriage: 0.85, friendship_first: 0.7, open: 0.6, casual: 0.15 },
  marriage: { marriage: 1, long_term: 0.85, friendship_first: 0.55, open: 0.5, casual: 0.05 },
  friendship_first: { friendship_first: 1, long_term: 0.7, marriage: 0.55, open: 0.7, casual: 0.35 },
  open: { open: 1, long_term: 0.6, marriage: 0.5, friendship_first: 0.7, casual: 0.7 },
  casual: { casual: 1, open: 0.7, friendship_first: 0.35, long_term: 0.15, marriage: 0.05 },
};
export const HARD_GOAL_MIN = 0.3;

export function relationshipCompat(a: string, b: string): number {
  return REL[a]?.[b] ?? 0.5;
}

/** Relationship-type pairs excluded by the hard filter (used to build the SQL). */
export function incompatibleRelationshipPairs(): [string, string][] {
  const out: [string, string][] = [];
  for (const [a, row] of Object.entries(REL)) for (const [b, v] of Object.entries(row)) if (v < HARD_GOAL_MIN) out.push([a, b]);
  return out;
}

export function childrenConflict(a: string, b: string): boolean {
  return (a === 'yes' && b === 'no') || (a === 'no' && b === 'yes');
}

export function timelineConflict(a: string, b: string): boolean {
  return (a === 'asap' && b === 'no_rush') || (a === 'no_rush' && b === 'asap');
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** B passes A's one-directional requirements. */
function acceptableTo(a: MatchProfile, b: MatchProfile): string | null {
  if (!a.seeking.includes(b.gender)) return 'gender';
  if (b.age < a.ageMin || b.age > a.ageMax) return 'age';
  const db = a.dealBreakers;
  if (b.lifestyle.smoking && db.excludeSmoking.includes(b.lifestyle.smoking)) return 'dealbreaker:smoking';
  if (b.lifestyle.alcohol && db.excludeAlcohol.includes(b.lifestyle.alcohol)) return 'dealbreaker:alcohol';
  if (b.lifestyle.pets && db.excludePets.includes(b.lifestyle.pets)) return 'dealbreaker:pets';
  if (db.noPartnerChildren && b.hasChildren) return 'dealbreaker:children';
  return null;
}

/**
 * Pure mirror of the SQL hard filters, evaluated in both directions.
 * Returns null when the pair passes, otherwise the first failing reason.
 */
export function hardFilterReason(a: MatchProfile, b: MatchProfile): string | null {
  if (a.userId === b.userId) return 'self';
  const ab = acceptableTo(a, b);
  if (ab) return `a:${ab}`;
  const ba = acceptableTo(b, a);
  if (ba) return `b:${ba}`;
  if (haversineKm(a.lat, a.lng, b.lat, b.lng) > Math.min(a.radiusKm, b.radiusKm)) return 'distance';
  if (relationshipCompat(a.relationshipType, b.relationshipType) < HARD_GOAL_MIN) return 'relationship_type';
  if (childrenConflict(a.wantsChildren, b.wantsChildren)) return 'children';
  if (timelineConflict(a.timeline, b.timeline)) return 'timeline';
  return null;
}

export function passesHardFilters(a: MatchProfile, b: MatchProfile): boolean {
  return hardFilterReason(a, b) === null;
}
