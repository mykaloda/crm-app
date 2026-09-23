import { DEFAULT_WEIGHTS } from '@agentmatch/shared';
import { hardFilterReason, haversineKm, incompatibleRelationshipPairs, passesHardFilters } from './filters';
import { MatchProfile } from './match-profile';
import {
  activityScore,
  goalsValuesScore,
  interestsScore,
  lifestyleScore,
  personalityScore,
  scoreDirectional,
  scorePair,
} from './scoring';

const NOW = new Date('2026-09-23T12:00:00Z');

function mp(over: Partial<MatchProfile> & { userId: string }): MatchProfile {
  return {
    age: 32,
    gender: 'woman',
    seeking: ['man'],
    ageMin: 25,
    ageMax: 45,
    lat: 52.52,
    lng: 13.405,
    radiusKm: 50,
    relationshipType: 'long_term',
    hasChildren: false,
    wantsChildren: 'yes',
    timeline: 'within_1y',
    lifestyle: { smoking: 'never', alcohol: 'socially', exercise: 'often', schedule: 'early_bird', pets: 'dog', relocation: 'maybe' },
    values: { family: 5, career: 3, money: 3 },
    personality: { openness: 70, conscientiousness: 60, extraversion: 50, agreeableness: 70, neuroticism: 30, communicationStyle: 'direct', temperament: 'balanced' },
    interestTags: ['hiking', 'cooking', 'books'],
    dealBreakers: { excludeSmoking: [], excludeAlcohol: [], excludePets: [], noPartnerChildren: false },
    completeness: 100,
    lastActiveAt: NOW,
    ...over,
  };
}

const ann = mp({ userId: 'ann' });
const bob = mp({ userId: 'bob', gender: 'man', seeking: ['woman'], age: 35 });

describe('hard filters', () => {
  it('passes a compatible pair in both directions', () => {
    expect(hardFilterReason(ann, bob)).toBeNull();
    expect(hardFilterReason(bob, ann)).toBeNull();
  });

  it('requires mutual gender interest', () => {
    expect(hardFilterReason(ann, { ...bob, seeking: ['man'] })).toBe('b:gender');
    expect(hardFilterReason(ann, { ...bob, gender: 'woman' })).toBe('a:gender');
  });

  it('checks both age ranges', () => {
    expect(hardFilterReason(ann, { ...bob, age: 50 })).toBe('a:age');
    expect(hardFilterReason(ann, { ...bob, ageMin: 35 })).toBe('b:age');
  });

  it('uses the smaller radius', () => {
    const hamburg = { ...bob, lat: 53.55, lng: 9.99, radiusKm: 1000 };
    expect(haversineKm(ann.lat, ann.lng, hamburg.lat, hamburg.lng)).toBeGreaterThan(250);
    expect(hardFilterReason(ann, hamburg)).toBe('distance');
    expect(hardFilterReason({ ...ann, radiusKm: 400 }, hamburg)).toBeNull();
  });

  it('applies goal conflicts', () => {
    expect(hardFilterReason(ann, { ...bob, relationshipType: 'casual' })).toBe('relationship_type');
    expect(hardFilterReason(ann, { ...bob, wantsChildren: 'no' })).toBe('children');
    expect(hardFilterReason(ann, { ...bob, wantsChildren: 'maybe' })).toBeNull();
    expect(hardFilterReason({ ...ann, timeline: 'asap' }, { ...bob, timeline: 'no_rush' })).toBe('timeline');
  });

  it('applies deal-breakers in both directions', () => {
    const smoker = { ...bob, lifestyle: { ...bob.lifestyle, smoking: 'regularly' } };
    const picky = { ...ann, dealBreakers: { ...ann.dealBreakers, excludeSmoking: ['regularly'] } };
    expect(hardFilterReason(picky, smoker)).toBe('a:dealbreaker:smoking');
    expect(hardFilterReason(smoker, picky)).toBe('b:dealbreaker:smoking');
    const parent = { ...bob, hasChildren: true };
    expect(passesHardFilters({ ...ann, dealBreakers: { ...ann.dealBreakers, noPartnerChildren: true } }, parent)).toBe(false);
    const allergicBob = { ...bob, dealBreakers: { ...bob.dealBreakers, excludePets: ['dog'] } };
    expect(hardFilterReason(ann, allergicBob)).toBe('b:dealbreaker:pets');
  });

  it('lists incompatible relationship pairs symmetrically', () => {
    const pairs = incompatibleRelationshipPairs().map((p) => p.join('>'));
    expect(pairs).toEqual(expect.arrayContaining(['casual>marriage', 'marriage>casual', 'casual>long_term', 'long_term>casual']));
  });
});

describe('section scores', () => {
  it('identical profiles score high on every similarity section', () => {
    expect(goalsValuesScore(ann, bob)).toBeGreaterThan(0.95);
    expect(lifestyleScore(ann, bob)).toBe(1);
    expect(interestsScore(ann, bob)).toBe(1);
    expect(personalityScore(ann, bob)).toBeGreaterThan(0.9);
  });

  it('goals: children and relationship type matter', () => {
    const maybe = goalsValuesScore(ann, { ...bob, wantsChildren: 'maybe' });
    const open = goalsValuesScore(ann, { ...bob, relationshipType: 'open' });
    expect(maybe).toBeLessThan(goalsValuesScore(ann, bob));
    expect(open).toBeLessThan(goalsValuesScore(ann, bob));
  });

  it('values: importance makes faith mismatch count more (directional)', () => {
    const withFaith = (m: MatchProfile, faith: string, imp: number) => ({ ...m, values: { ...m.values, faith: faith as never, faithImportance: imp } });
    const devout = withFaith(ann, 'christian', 5);
    const relaxed = withFaith(ann, 'christian', 1);
    const other = withFaith(bob, 'muslim', 3);
    expect(goalsValuesScore(devout, other)).toBeLessThan(goalsValuesScore(relaxed, other));
  });

  it('values: missing values fall back to goals only', () => {
    expect(goalsValuesScore({ ...ann, values: undefined }, bob)).toBeCloseTo(goalsValuesScore({ ...ann, values: undefined }, { ...bob, values: undefined }));
  });

  it('lifestyle: allergy vs pet is the worst pet combination', () => {
    const allergic = { ...bob, lifestyle: { ...bob.lifestyle, pets: 'allergic' } };
    const cat = { ...bob, lifestyle: { ...bob.lifestyle, pets: 'cat' } };
    expect(lifestyleScore(ann, allergic)).toBeLessThan(lifestyleScore(ann, cat));
    const owl = { ...bob, lifestyle: { ...bob.lifestyle, schedule: 'night_owl' } };
    expect(lifestyleScore(ann, owl)).toBeLessThan(1);
  });

  it('personality: prefers emotionally stable partners (directional)', () => {
    const anxious = { ...bob, personality: { ...bob.personality!, neuroticism: 90 } };
    expect(personalityScore(ann, anxious)).toBeLessThan(personalityScore(anxious, ann));
    expect(personalityScore({ ...ann, personality: undefined }, bob)).toBe(0.5);
  });

  it('interests: coverage is directional', () => {
    const narrow = { ...ann, interestTags: ['hiking'] };
    const broad = { ...bob, interestTags: ['hiking', 'chess', 'jazz', 'surfing', 'poetry', 'gaming'] };
    expect(interestsScore(narrow, broad)).toBeGreaterThan(interestsScore(broad, narrow));
    expect(interestsScore({ ...ann, interestTags: [] }, bob)).toBe(0.5);
    expect(interestsScore({ ...ann, interestTags: [] }, bob, 0.5)).toBe(1);
  });

  it('activity: recency and completeness', () => {
    expect(activityScore(bob, NOW)).toBe(1);
    expect(activityScore({ ...bob, lastActiveAt: new Date('2026-06-01'), completeness: 50 }, NOW)).toBeCloseTo(0.3);
    expect(activityScore({ ...bob, lastActiveAt: null, completeness: 0 }, NOW)).toBeCloseTo(0.05);
  });
});

describe('total score', () => {
  it('is 0-100 and respects weights', () => {
    const s = scoreDirectional(ann, bob, DEFAULT_WEIGHTS, { now: NOW });
    expect(s.total).toBeGreaterThan(90);
    expect(s.total).toBeLessThanOrEqual(100);
    const onlyActivity = scoreDirectional(ann, { ...bob, lastActiveAt: null, completeness: 0 }, { goalsValues: 0, lifestyle: 0, personality: 0, interests: 0, activity: 100 }, { now: NOW });
    expect(onlyActivity.total).toBeCloseTo(5);
  });

  it('final score is the minimum of both directions', () => {
    const inactiveBob = { ...bob, lastActiveAt: new Date('2025-01-01'), completeness: 40, interestTags: ['hiking', 'chess', 'jazz', 'surfing', 'poetry', 'gaming'] };
    const r = scorePair(ann, inactiveBob, DEFAULT_WEIGHTS, { now: NOW });
    expect(r.ab.total).not.toBe(r.ba.total);
    expect(r.score).toBe(Math.min(r.ab.total, r.ba.total));
  });

  it('a worse partner scores lower', () => {
    const good = scorePair(ann, bob, DEFAULT_WEIGHTS, { now: NOW }).score;
    const worse = scorePair(
      ann,
      {
        ...bob,
        relationshipType: 'open',
        wantsChildren: 'maybe',
        lifestyle: { smoking: 'regularly', alcohol: 'regularly', exercise: 'never', schedule: 'night_owl', pets: 'allergic', relocation: 'no' },
        interestTags: ['gaming'],
        values: { family: 1, career: 5, money: 5 },
      },
      DEFAULT_WEIGHTS,
      { now: NOW },
    ).score;
    expect(worse).toBeLessThan(good - 20);
  });
});
