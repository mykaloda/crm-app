import { z } from 'zod';
import { Visibility, clampVisibility } from './visibility';

// ---------- enums ----------
export const GENDERS = ['woman', 'man', 'nonbinary'] as const;
export const RELATIONSHIP_TYPES = ['long_term', 'marriage', 'casual', 'friendship_first', 'open'] as const;
export const WANTS_CHILDREN = ['yes', 'no', 'maybe'] as const;
export const TIMELINES = ['asap', 'within_1y', 'within_3y', 'no_rush'] as const;
export const FREQUENCY = ['never', 'socially', 'regularly'] as const;
export const EXERCISE = ['never', 'sometimes', 'often', 'daily'] as const;
export const SCHEDULES = ['early_bird', 'night_owl', 'flexible', 'shift_work'] as const;
export const PETS = ['none', 'dog', 'cat', 'other', 'allergic'] as const;
export const RELOCATION = ['no', 'maybe', 'yes'] as const;
export const FAITH = ['none', 'spiritual', 'christian', 'muslim', 'jewish', 'hindu', 'buddhist', 'other'] as const;
export const POLITICS = ['left', 'center_left', 'center', 'center_right', 'right', 'apolitical'] as const;
export const COMMUNICATION_STYLES = ['direct', 'diplomatic', 'playful', 'reserved'] as const;
export const TEMPERAMENTS = ['calm', 'balanced', 'energetic'] as const;

export type Gender = (typeof GENDERS)[number];
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

const importance = z.number().int().min(1).max(5);
const pct = z.number().int().min(0).max(100);

// ---------- sections ----------
export const basicSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD'),
  gender: z.enum(GENDERS),
  seeking: z.array(z.enum(GENDERS)).min(1),
  ageMin: z.number().int().min(18).max(99),
  ageMax: z.number().int().min(18).max(99),
  city: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z.number().int().min(1).max(20000),
});

export const goalsSchema = z.object({
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  hasChildren: z.boolean(),
  wantsChildren: z.enum(WANTS_CHILDREN),
  timeline: z.enum(TIMELINES),
});

export const lifestyleSchema = z.object({
  smoking: z.enum(FREQUENCY),
  alcohol: z.enum(FREQUENCY),
  exercise: z.enum(EXERCISE),
  schedule: z.enum(SCHEDULES),
  pets: z.enum(PETS),
  relocation: z.enum(RELOCATION),
});

export const valuesSchema = z.object({
  family: importance,
  career: importance,
  money: importance,
  faith: z.enum(FAITH),
  faithImportance: importance,
  politics: z.enum(POLITICS),
  politicsImportance: importance,
});

export const personalitySchema = z.object({
  openness: pct,
  conscientiousness: pct,
  extraversion: pct,
  agreeableness: pct,
  neuroticism: pct,
  communicationStyle: z.enum(COMMUNICATION_STYLES),
  temperament: z.enum(TEMPERAMENTS),
});

export const interestsSchema = z.object({
  interestTags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30),
  interestsText: z.string().max(1000),
});

export const dealBreakersSchema = z.object({
  excludeSmoking: z.array(z.enum(FREQUENCY)),
  excludeAlcohol: z.array(z.enum(FREQUENCY)),
  excludePets: z.array(z.enum(PETS)),
  noPartnerChildren: z.boolean(),
});

export const descriptionSchema = z.object({
  aiDescription: z.string().trim().max(2500),
});

export const SECTION_SCHEMAS = {
  basic: basicSchema,
  goals: goalsSchema,
  lifestyle: lifestyleSchema,
  values: valuesSchema,
  personality: personalitySchema,
  interests: interestsSchema,
  dealBreakers: dealBreakersSchema,
  description: descriptionSchema,
} as const;

export type SectionKey = keyof typeof SECTION_SCHEMAS;
export const SECTION_KEYS = Object.keys(SECTION_SCHEMAS) as SectionKey[];

/** Full profile data as stored/edited. Every section is optional (drafts are partial). */
export const profileDataSchema = z.object({
  basic: basicSchema.partial().optional(),
  goals: goalsSchema.partial().optional(),
  lifestyle: lifestyleSchema.partial().optional(),
  values: valuesSchema.partial().optional(),
  personality: personalitySchema.partial().optional(),
  interests: interestsSchema.partial().optional(),
  dealBreakers: dealBreakersSchema.partial().optional(),
  description: descriptionSchema.partial().optional(),
});
export type ProfileData = z.infer<typeof profileDataSchema>;

/** Patch accepted from agents (update_profile). Strict: unknown keys are rejected. */
export const profilePatchSchema = profileDataSchema.strict();
export type ProfilePatch = ProfileData;

// ---------- field registry ----------
export type FilterKind = 'hard' | 'weighted' | 'soft';

export interface FieldDef {
  key: string;
  section: SectionKey;
  filter: FilterKind;
  defaultVisibility: Visibility;
  minVisibility: Visibility;
  maxVisibility: Visibility;
  /** Stored encrypted at field level. */
  encrypted?: boolean;
  /** GDPR special-category data; requires explicit sensitive-data consent. */
  sensitive?: boolean;
  required?: boolean;
  /** Human/agent-facing hint used in the schema tool and the interview. */
  hint: string;
}

type SectionMeta = {
  filter: FilterKind;
  vis: Visibility;
  min?: Visibility;
  max?: Visibility;
  encrypted?: boolean;
  required?: boolean;
};

const SECTION_META: Record<SectionKey, SectionMeta> = {
  basic: { filter: 'hard', vis: 'people', min: 'algorithm_only', required: true },
  goals: { filter: 'hard', vis: 'people', min: 'algorithm_only', required: true },
  lifestyle: { filter: 'weighted', vis: 'agents', min: 'algorithm_only' },
  values: { filter: 'soft', vis: 'algorithm_only', encrypted: true },
  personality: { filter: 'soft', vis: 'algorithm_only' },
  interests: { filter: 'soft', vis: 'agents' },
  dealBreakers: { filter: 'hard', vis: 'algorithm_only', min: 'algorithm_only', max: 'agents' },
  description: { filter: 'soft', vis: 'agents' },
};

const HINTS: Record<string, string> = {
  displayName: 'First name or nickname shown to matches',
  birthDate: 'Date of birth, YYYY-MM-DD. Must be 18+',
  gender: 'Own gender',
  seeking: 'Genders the person wants to meet',
  ageMin: 'Youngest acceptable partner age',
  ageMax: 'Oldest acceptable partner age',
  city: 'City name',
  lat: 'Approximate latitude of the city (never shown to anyone)',
  lng: 'Approximate longitude of the city (never shown to anyone)',
  radiusKm: 'Maximum distance to a partner in km',
  relationshipType: 'What kind of relationship they want',
  hasChildren: 'Whether they already have children',
  wantsChildren: 'Whether they want (more) children',
  timeline: 'How soon they want a committed relationship',
  smoking: 'Smoking habits',
  alcohol: 'Drinking habits',
  exercise: 'How often they exercise',
  schedule: 'Daily rhythm',
  pets: 'Pets they have, or allergy',
  relocation: 'Willingness to relocate for a partner',
  family: 'Importance of family, 1-5',
  career: 'Importance of career, 1-5',
  money: 'Importance of financial ambition, 1-5',
  faith: 'Religion or worldview (sensitive, optional)',
  faithImportance: 'How important shared faith is in a partner, 1-5',
  politics: 'Political leaning (sensitive, optional)',
  politicsImportance: 'How important shared politics is in a partner, 1-5',
  openness: 'Big Five openness 0-100',
  conscientiousness: 'Big Five conscientiousness 0-100',
  extraversion: 'Big Five extraversion 0-100',
  agreeableness: 'Big Five agreeableness 0-100',
  neuroticism: 'Big Five neuroticism 0-100',
  communicationStyle: 'How they communicate',
  temperament: 'General temperament',
  interestTags: 'Short lowercase interest tags, up to 30',
  interestsText: 'Free text about hobbies and passions',
  excludeSmoking: 'Partner smoking levels that are unacceptable',
  excludeAlcohol: 'Partner drinking levels that are unacceptable',
  excludePets: 'Partner pet situations that are unacceptable',
  noPartnerChildren: 'True if a partner with children is unacceptable',
  aiDescription: 'Warm third-person description, 150-300 words, no contact details or full name',
};

const SENSITIVE = new Set(['faith', 'politics', 'faithImportance', 'politicsImportance']);

export const FIELD_DEFS: FieldDef[] = SECTION_KEYS.flatMap((section) => {
  const meta = SECTION_META[section];
  const shape = SECTION_SCHEMAS[section].shape as Record<string, unknown>;
  return Object.keys(shape).map((key) => {
    // Exact coordinates can never leave the algorithm.
    const isGeo = key === 'lat' || key === 'lng';
    return {
      key,
      section,
      filter: meta.filter,
      defaultVisibility: isGeo ? 'algorithm_only' : meta.vis,
      minVisibility: meta.min ?? 'hidden',
      maxVisibility: isGeo ? 'algorithm_only' : meta.max ?? 'people',
      encrypted: meta.encrypted,
      sensitive: SENSITIVE.has(key),
      required: meta.required,
      hint: HINTS[key] ?? key,
    } satisfies FieldDef;
  });
});

export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f]));

/** Pseudo-field for photos; visibility is fixed. */
export const PHOTOS_FIELD = { key: 'photos', min: 3, max: 6, visibility: 'people' as Visibility };

export type VisibilityMap = Record<string, Visibility>;

export function defaultVisibilityMap(): VisibilityMap {
  return Object.fromEntries(FIELD_DEFS.map((f) => [f.key, f.defaultVisibility]));
}

/** Merge a user-supplied map over defaults, clamping each entry to its allowed range. */
export function normalizeVisibilityMap(input: Partial<VisibilityMap> | null | undefined): VisibilityMap {
  const out = defaultVisibilityMap();
  for (const [key, v] of Object.entries(input ?? {})) {
    const def = FIELD_BY_KEY[key];
    if (!def || !v) continue;
    out[key] = clampVisibility(v, def.minVisibility, def.maxVisibility);
  }
  return out;
}

// ---------- helpers ----------
export function ageFromBirthDate(birthDate: string | Date, now: Date = new Date()): number {
  const b = typeof birthDate === 'string' ? new Date(`${birthDate}T00:00:00Z`) : birthDate;
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  const m = now.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
  return age;
}

export function wordCount(text: string | undefined | null): number {
  return (text ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Share of fields filled, 0-100. Required sections weigh double.
 * The AI description counts only when within 150-300 words.
 */
export function profileCompleteness(data: ProfileData): number {
  let total = 0;
  let filled = 0;
  for (const f of FIELD_DEFS) {
    if (f.sensitive) continue; // optional by design, never penalised
    const w = f.required ? 2 : 1;
    total += w;
    const v = (data[f.section] as Record<string, unknown> | undefined)?.[f.key];
    let ok = v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0 && f.section !== 'dealBreakers');
    if (f.key === 'aiDescription') {
      const wc = wordCount(v as string);
      ok = wc >= 150 && wc <= 300;
    }
    if (f.section === 'dealBreakers') ok = v !== undefined;
    if (ok) filled += w;
  }
  return Math.round((filled / total) * 100);
}

/** Missing required fields that block activation. */
export function missingRequired(data: ProfileData): string[] {
  return FIELD_DEFS.filter((f) => f.required)
    .filter((f) => {
      const v = (data[f.section] as Record<string, unknown> | undefined)?.[f.key];
      return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    })
    .map((f) => f.key);
}

/** Deep-merge a patch into profile data (section level shallow merge). */
export function mergeProfile(base: ProfileData, patch: ProfileData): ProfileData {
  const out: ProfileData = { ...base };
  for (const s of SECTION_KEYS) {
    const p = patch[s];
    if (p) (out as Record<string, unknown>)[s] = { ...(base[s] ?? {}), ...p };
  }
  return out;
}

/** Keep only fields whose visibility allows the audience. */
export function redactProfile(
  data: ProfileData,
  visibility: VisibilityMap,
  audience: 'agents' | 'people',
): ProfileData {
  const need = audience === 'agents' ? 2 : 3;
  const rank = { hidden: 0, algorithm_only: 1, agents: 2, people: 3 } as const;
  const out: Record<string, Record<string, unknown>> = {};
  for (const f of FIELD_DEFS) {
    const v = (data[f.section] as Record<string, unknown> | undefined)?.[f.key];
    if (v === undefined) continue;
    if (rank[visibility[f.key] ?? f.defaultVisibility] < need) continue;
    (out[f.section] ??= {})[f.key] = v;
  }
  return out as ProfileData;
}
