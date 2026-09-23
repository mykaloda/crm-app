import { Prisma, Profile } from '@prisma/client';
import { ProfileData, VisibilityMap, normalizeVisibilityMap } from '@agentmatch/shared';
import { CryptoService } from '../common/crypto.service';

const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : undefined);
const def = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);

function compact<T extends Record<string, unknown>>(o: T): Partial<T> | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
  return Object.keys(out).length ? out : undefined;
}

/** DB row -> ProfileData (values decrypted). */
export function rowToProfileData(row: Profile | null, crypto: CryptoService): ProfileData {
  if (!row) return {};
  const data: ProfileData = {
    basic: compact({
      displayName: def(row.displayName),
      birthDate: iso(row.birthDate),
      gender: def(row.gender) as never,
      seeking: row.seeking.length ? (row.seeking as never) : undefined,
      ageMin: def(row.ageMin),
      ageMax: def(row.ageMax),
      city: def(row.city),
      lat: def(row.lat),
      lng: def(row.lng),
      radiusKm: def(row.radiusKm),
    }),
    goals: compact({
      relationshipType: def(row.relationshipType) as never,
      hasChildren: def(row.hasChildren),
      wantsChildren: def(row.wantsChildren) as never,
      timeline: def(row.timeline) as never,
    }),
    lifestyle: compact({
      smoking: def(row.smoking) as never,
      alcohol: def(row.alcohol) as never,
      exercise: def(row.exercise) as never,
      schedule: def(row.schedule) as never,
      pets: def(row.pets) as never,
      relocation: def(row.relocation) as never,
    }),
    values: crypto.decryptJson<ProfileData['values']>(row.valuesEnc),
    personality: (row.personality as ProfileData['personality']) ?? undefined,
    interests: compact({
      interestTags: row.interestTags.length ? row.interestTags : undefined,
      interestsText: def(row.interestsText),
    }),
    dealBreakers: (row.dealBreakers as ProfileData['dealBreakers']) ?? undefined,
    description: compact({ aiDescription: def(row.aiDescription) }),
  };
  for (const k of Object.keys(data) as (keyof ProfileData)[]) if (data[k] === undefined) delete data[k];
  return data;
}

/** ProfileData -> column values for Prisma (values encrypted). */
export function profileDataToColumns(data: ProfileData, crypto: CryptoService): Prisma.ProfileUncheckedUpdateInput {
  const b = data.basic ?? {};
  const g = data.goals ?? {};
  const l = data.lifestyle ?? {};
  const hasValues = data.values && Object.keys(data.values).length > 0;
  return {
    displayName: b.displayName ?? null,
    birthDate: b.birthDate ? new Date(`${b.birthDate}T00:00:00Z`) : null,
    gender: b.gender ?? null,
    seeking: b.seeking ?? [],
    ageMin: b.ageMin ?? null,
    ageMax: b.ageMax ?? null,
    city: b.city ?? null,
    lat: b.lat ?? null,
    lng: b.lng ?? null,
    radiusKm: b.radiusKm ?? null,
    relationshipType: g.relationshipType ?? null,
    hasChildren: g.hasChildren ?? null,
    wantsChildren: g.wantsChildren ?? null,
    timeline: g.timeline ?? null,
    smoking: l.smoking ?? null,
    alcohol: l.alcohol ?? null,
    exercise: l.exercise ?? null,
    schedule: l.schedule ?? null,
    pets: l.pets ?? null,
    relocation: l.relocation ?? null,
    personality: data.personality ? (data.personality as Prisma.InputJsonValue) : Prisma.DbNull,
    interestTags: data.interests?.interestTags ?? [],
    interestsText: data.interests?.interestsText ?? null,
    valuesEnc: hasValues ? crypto.encryptJson(data.values) : null,
    dealBreakers: data.dealBreakers ? (data.dealBreakers as Prisma.InputJsonValue) : Prisma.DbNull,
    aiDescription: data.description?.aiDescription ?? null,
  };
}

export function rowVisibility(row: Pick<Profile, 'visibility'> | null): VisibilityMap {
  return normalizeVisibilityMap((row?.visibility ?? {}) as Partial<VisibilityMap>);
}
