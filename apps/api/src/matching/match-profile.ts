import { ProfileData, VisibilityMap } from '@agentmatch/shared';

/** Flattened profile used by filters and scoring. Fields the user hid are left undefined. */
export interface MatchProfile {
  userId: string;
  age: number;
  gender: string;
  seeking: string[];
  ageMin: number;
  ageMax: number;
  lat: number;
  lng: number;
  radiusKm: number;
  relationshipType: string;
  hasChildren: boolean;
  wantsChildren: string;
  timeline: string;
  lifestyle: Partial<Record<'smoking' | 'alcohol' | 'exercise' | 'schedule' | 'pets' | 'relocation', string>>;
  values?: ProfileData['values'];
  personality?: ProfileData['personality'];
  interestTags: string[];
  dealBreakers: {
    excludeSmoking: string[];
    excludeAlcohol: string[];
    excludePets: string[];
    noPartnerChildren: boolean;
  };
  completeness: number;
  lastActiveAt?: Date | null;
}

/** Drop soft fields the user marked hidden: hidden means "not used by anything". */
export function applyHidden(data: ProfileData, visibility: VisibilityMap): ProfileData {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [section, fields] of Object.entries(data)) {
    if (!fields) continue;
    out[section] = Object.fromEntries(Object.entries(fields).filter(([k]) => visibility[k] !== 'hidden'));
  }
  return out as ProfileData;
}

export function toMatchProfile(
  userId: string,
  data: ProfileData,
  meta: { age: number; completeness: number; lastActiveAt?: Date | null },
): MatchProfile {
  const b = data.basic ?? {};
  const g = data.goals ?? {};
  const d = data.dealBreakers ?? {};
  return {
    userId,
    age: meta.age,
    gender: b.gender ?? '',
    seeking: b.seeking ?? [],
    ageMin: b.ageMin ?? 18,
    ageMax: b.ageMax ?? 99,
    lat: b.lat ?? 0,
    lng: b.lng ?? 0,
    radiusKm: b.radiusKm ?? 50,
    relationshipType: g.relationshipType ?? 'open',
    hasChildren: g.hasChildren ?? false,
    wantsChildren: g.wantsChildren ?? 'maybe',
    timeline: g.timeline ?? 'no_rush',
    lifestyle: { ...(data.lifestyle ?? {}) },
    values: data.values,
    personality: data.personality,
    interestTags: data.interests?.interestTags ?? [],
    dealBreakers: {
      excludeSmoking: d.excludeSmoking ?? [],
      excludeAlcohol: d.excludeAlcohol ?? [],
      excludePets: d.excludePets ?? [],
      noPartnerChildren: d.noPartnerChildren ?? false,
    },
    completeness: meta.completeness,
    lastActiveAt: meta.lastActiveAt,
  };
}
