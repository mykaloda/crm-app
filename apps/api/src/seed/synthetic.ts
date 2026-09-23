import { ProfileData, wordCount } from '@agentmatch/shared';

/** Deterministic PRNG so seeds and tests are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const pick = <T>(r: Rng, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const int = (r: Rng, min: number, max: number) => min + Math.floor(r() * (max - min + 1));
function weighted<T>(r: Rng, xs: readonly [T, number][]): T {
  const total = xs.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of xs) if ((x -= w) < 0) return v;
  return xs[xs.length - 1][0];
}
function sample<T>(r: Rng, xs: readonly T[], n: number): T[] {
  const copy = [...xs];
  const out: T[] = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(r() * copy.length), 1)[0]);
  return out;
}

const CITIES = [
  { city: 'Berlin', lat: 52.52, lng: 13.405, w: 60 },
  { city: 'Potsdam', lat: 52.39, lng: 13.065, w: 10 },
  { city: 'Hamburg', lat: 53.551, lng: 9.993, w: 12 },
  { city: 'Munich', lat: 48.137, lng: 11.575, w: 10 },
  { city: 'Leipzig', lat: 51.34, lng: 12.375, w: 8 },
] as const;

export const ARCHETYPES = {
  outdoors: { tags: ['hiking', 'climbing', 'camping', 'cycling', 'trail running', 'kayaking'], line: 'spends weekends outdoors, chasing mountain trails, lakes and long cycling routes' },
  arts: { tags: ['painting', 'museums', 'theatre', 'photography', 'jazz', 'poetry'], line: 'is drawn to galleries, small theatres, jazz bars and film photography' },
  tech: { tags: ['programming', 'board games', 'sci-fi', 'gaming', 'robotics', 'podcasts'], line: 'loves building things, strategy board games, science fiction and long podcast walks' },
  foodie: { tags: ['cooking', 'wine', 'baking', 'restaurants', 'farmers markets', 'coffee'], line: 'plans the week around farmers markets, slow cooking, natural wine and new restaurants' },
  sporty: { tags: ['football', 'gym', 'yoga', 'tennis', 'swimming', 'marathon'], line: 'trains most mornings, from yoga and swimming to tennis and marathon preparation' },
  bookish: { tags: ['books', 'writing', 'history', 'philosophy', 'languages', 'chess'], line: 'reads constantly, writes a little, studies languages and never refuses a game of chess' },
  social: { tags: ['travel', 'dancing', 'festivals', 'volunteering', 'concerts', 'karaoke'], line: 'fills the calendar with travel, dancing, festivals, concerts and volunteering' },
} as const;
type Archetype = keyof typeof ARCHETYPES;

const NAMES = {
  woman: ['Anna', 'Lena', 'Mia', 'Sofia', 'Clara', 'Emma', 'Hanna', 'Lea', 'Marie', 'Nora', 'Paula', 'Ida', 'Greta', 'Julia', 'Sara'],
  man: ['Lukas', 'Jonas', 'Felix', 'Paul', 'Leon', 'Max', 'Noah', 'Elias', 'Ben', 'Finn', 'Tom', 'David', 'Jan', 'Simon', 'Moritz'],
  nonbinary: ['Alex', 'Robin', 'Kim', 'Sascha', 'Charlie', 'Luca'],
};

const JOBS = ['a nurse', 'a software engineer', 'a teacher', 'an architect', 'a physiotherapist', 'a product designer', 'a chef', 'a lawyer', 'a researcher', 'a marketing lead', 'a carpenter', 'a doctor', 'a journalist', 'an accountant', 'a musician'];

export interface SyntheticPerson {
  email: string;
  archetype: Archetype;
  sensitive: boolean;
  lastActiveDaysAgo: number;
  data: ProfileData;
}

function describe(r: Rng, p: { name: string; gender: string; age: number; city: string; job: string; primary: Archetype; secondary: Archetype; data: ProfileData }): string {
  const they = p.gender === 'woman' ? 'She' : p.gender === 'man' ? 'He' : 'They';
  const their = p.gender === 'woman' ? 'her' : p.gender === 'man' ? 'his' : 'their';
  const is = they === 'They' ? 'are' : 'is';
  const g = p.data.goals!;
  const l = p.data.lifestyle!;
  const rel: Record<string, string> = {
    long_term: 'a long-term relationship built on trust and everyday kindness',
    marriage: 'a committed partnership that could lead to marriage',
    friendship_first: 'a connection that starts as friendship and grows slowly',
    open: 'whatever feels right with the right person, without pressure',
    casual: 'something light and fun without heavy expectations',
  };
  const kids = g.wantsChildren === 'yes' ? 'would love to raise children one day' : g.wantsChildren === 'no' ? 'does not plan to have children' : 'is still open about children';
  const sentences = [
    `${they} ${is} ${p.age} and lives in ${p.city}, working as ${p.job}.`,
    `${they} ${ARCHETYPES[p.primary].line}.`,
    `In quieter weeks ${they.toLowerCase()} also ${ARCHETYPES[p.secondary].line}.`,
    `${they} ${is} looking for ${rel[g.relationshipType!]}.`,
    `When it comes to family, ${they.toLowerCase()} ${kids}${g.hasChildren ? ' and already has a child who comes first' : ''}.`,
    `Friends describe ${their} energy as ${pick(r, ['calm and grounded', 'warm and curious', 'playful and quick', 'thoughtful and steady', 'bright and adventurous'])}, and ${their} humour as ${pick(r, ['dry', 'silly', 'gentle', 'sharp', 'warm'])}.`,
    `${they} ${l.schedule === 'early_bird' ? 'is up early and loves slow mornings with coffee' : l.schedule === 'night_owl' ? 'comes alive in the evening and loves late conversations' : 'keeps a flexible rhythm that changes with the season'}.`,
    `${l.smoking === 'never' ? 'Smoke-free' : 'An occasional smoker'}, ${they.toLowerCase()} ${l.alcohol === 'never' ? 'does not drink' : l.alcohol === 'socially' ? 'enjoys a glass of wine with friends' : 'likes a good bar night'} and exercises ${l.exercise === 'daily' ? 'every day' : l.exercise === 'often' ? 'several times a week' : l.exercise === 'sometimes' ? 'now and then' : 'rarely'}.`,
    `${l.pets === 'dog' ? `A dog is part of ${their} daily routine.` : l.pets === 'cat' ? `A cat rules ${their} apartment.` : l.pets === 'allergic' ? `Pets are tricky because of an allergy.` : `There are no pets at home right now.`}`,
    `${their.charAt(0).toUpperCase() + their.slice(1)} ideal date would be ${pick(r, ['a long walk followed by street food', 'a cooking evening at home', 'an exhibition and a quiet bar', 'a day trip to a lake', 'a concert and late dinner', 'a bookshop crawl and coffee'])}.`,
    `${they} value${they === 'They' ? '' : 's'} honesty, curiosity and people who follow through on what they say.`,
    `Small things matter to ${their} partner search: remembering details, making time, and laughing at the same absurd moments.`,
    `${they} ${is} happiest when life mixes routine with a bit of adventure, and ${is} ready to meet someone who wants to build that together.`,
    `Weekends usually include ${ARCHETYPES[p.primary].tags.slice(0, 3).join(', ')} and time with close friends.`,
    `${they} believe${they === 'They' ? '' : 's'} good relationships are made of patience, generosity and a shared sense of direction.`,
  ];
  let text = sentences.join(' ');
  let i = 0;
  const extra = [
    `${they} also enjoy${they === 'They' ? '' : 's'} ${ARCHETYPES[p.secondary].tags.slice(0, 3).join(', ')} whenever there is a free evening.`,
    `Long conversations about books, travel plans and odd little dreams are ${their} favourite way to get to know someone.`,
    `${they} ${is} patient, reliable and quick to apologise when wrong.`,
  ];
  while (wordCount(text) < 170 && i < extra.length) text += ` ${extra[i++]}`;
  return text.split(/\s+/).slice(0, 290).join(' ');
}

export function generatePeople(n: number, seed = 42, emailDomain = 'seed.agentmatch.local'): SyntheticPerson[] {
  const r = mulberry32(seed);
  const people: SyntheticPerson[] = [];
  const archetypes = Object.keys(ARCHETYPES) as Archetype[];
  for (let i = 0; i < n; i++) {
    const orientation = weighted(r, [
      ['w>m', 46],
      ['m>w', 46],
      ['w>w', 4],
      ['m>m', 2],
      ['nb', 2],
    ] as const);
    const gender = orientation.startsWith('w') ? 'woman' : orientation.startsWith('m') ? 'man' : 'nonbinary';
    const seeking =
      orientation === 'w>m' ? ['man'] : orientation === 'm>w' ? ['woman'] : orientation === 'w>w' ? ['woman'] : orientation === 'm>m' ? ['man'] : ['woman', 'man', 'nonbinary'];
    const age = int(r, 22, 50);
    const birthYear = 2026 - age;
    const birthDate = `${birthYear - (r() < 0.7 ? 1 : 0)}-${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}`;
    const c = weighted(r, CITIES.map((x) => [x, x.w] as [(typeof CITIES)[number], number]));
    const primary = pick(r, archetypes);
    const secondary = pick(r, archetypes.filter((a) => a !== primary));
    const tags = [...sample(r, ARCHETYPES[primary].tags, 4), ...sample(r, ARCHETYPES[secondary].tags, 2)];
    const relationshipType = weighted(r, [
      ['long_term', 45],
      ['marriage', 15],
      ['friendship_first', 12],
      ['open', 15],
      ['casual', 13],
    ] as const);
    const smoking = weighted(r, [['never', 70], ['socially', 18], ['regularly', 12]] as const);
    const pets = weighted(r, [['none', 45], ['dog', 22], ['cat', 20], ['other', 5], ['allergic', 8]] as const);
    const sensitive = r() < 0.5;
    const data: ProfileData = {
      basic: {
        displayName: pick(r, NAMES[gender]),
        birthDate,
        gender,
        seeking: seeking as never,
        ageMin: Math.max(18, age - int(r, 4, 9)),
        ageMax: Math.min(99, age + int(r, 4, 10)),
        city: c.city,
        lat: Math.round((c.lat + (r() - 0.5) * 0.12) * 1e5) / 1e5,
        lng: Math.round((c.lng + (r() - 0.5) * 0.18) * 1e5) / 1e5,
        radiusKm: weighted(r, [[25, 20], [40, 35], [60, 30], [300, 15]] as const),
      },
      goals: {
        relationshipType,
        hasChildren: age > 30 && r() < 0.25,
        wantsChildren: weighted(r, [['yes', 40], ['maybe', 35], ['no', 25]] as const),
        timeline: weighted(r, [['asap', 10], ['within_1y', 35], ['within_3y', 30], ['no_rush', 25]] as const),
      },
      lifestyle: {
        smoking,
        alcohol: weighted(r, [['never', 20], ['socially', 65], ['regularly', 15]] as const),
        exercise: primary === 'sporty' || primary === 'outdoors' ? pick(r, ['often', 'daily'] as const) : weighted(r, [['never', 15], ['sometimes', 45], ['often', 30], ['daily', 10]] as const),
        schedule: weighted(r, [['early_bird', 35], ['night_owl', 30], ['flexible', 30], ['shift_work', 5]] as const),
        pets,
        relocation: weighted(r, [['no', 35], ['maybe', 45], ['yes', 20]] as const),
      },
      values: {
        family: int(r, 2, 5),
        career: int(r, 1, 5),
        money: int(r, 1, 5),
        ...(sensitive
          ? {
              faith: weighted(r, [['none', 45], ['spiritual', 20], ['christian', 22], ['muslim', 6], ['jewish', 3], ['buddhist', 4]] as const),
              faithImportance: int(r, 1, 5),
              politics: weighted(r, [['left', 15], ['center_left', 30], ['center', 25], ['center_right', 15], ['right', 5], ['apolitical', 10]] as const),
              politicsImportance: int(r, 1, 5),
            }
          : {}),
      },
      personality: {
        openness: int(r, 25, 95),
        conscientiousness: int(r, 25, 95),
        extraversion: int(r, 10, 95),
        agreeableness: int(r, 30, 95),
        neuroticism: int(r, 5, 80),
        communicationStyle: pick(r, ['direct', 'diplomatic', 'playful', 'reserved'] as const),
        temperament: pick(r, ['calm', 'balanced', 'energetic'] as const),
      },
      interests: { interestTags: tags, interestsText: `${ARCHETYPES[primary].line}; also into ${ARCHETYPES[secondary].tags.slice(0, 2).join(' and ')}.` },
      dealBreakers: {
        excludeSmoking: smoking === 'never' && r() < 0.5 ? ['regularly'] : [],
        excludeAlcohol: r() < 0.08 ? ['regularly'] : [],
        excludePets: pets === 'allergic' ? ['dog', 'cat'] : [],
        noPartnerChildren: r() < 0.1,
      },
    };
    const job = pick(r, JOBS);
    data.description = {
      aiDescription: describe(r, { name: data.basic!.displayName!, gender, age, city: c.city, job, primary, secondary, data }),
    };
    people.push({
      email: `person${String(i + 1).padStart(3, '0')}@${emailDomain}`,
      archetype: primary,
      sensitive,
      lastActiveDaysAgo: weighted(r, [[0, 40], [3, 30], [14, 20], [45, 10]] as const),
      data,
    });
  }
  return people;
}
