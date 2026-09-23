import { ProfileData, ScoreBreakdown } from '@agentmatch/shared';
import { AgentLLM, ExplainInput, InterviewInput, InterviewOutput, NegotiationDecision, NegotiationInput } from './agent-llm';
import { composeDescription } from './describe';

/** Approximate city centres for the scripted interviewer (the LLM interviewer knows geography itself). */
export const CITY_COORDS: Record<string, [number, number]> = {
  berlin: [52.52, 13.405],
  potsdam: [52.39, 13.065],
  hamburg: [53.551, 9.993],
  munich: [48.137, 11.575],
  leipzig: [51.34, 12.375],
  vienna: [48.208, 16.373],
  zurich: [47.377, 8.541],
  london: [51.507, -0.128],
  paris: [48.857, 2.352],
  amsterdam: [52.37, 4.895],
  'new york': [40.713, -74.006],
  'san francisco': [37.775, -122.419],
  moscow: [55.756, 37.617],
  'saint petersburg': [59.939, 30.316],
};

type Parsed = { patch?: ProfileData; error?: string };

const find = <T extends string>(text: string, options: Record<T, RegExp>): T | undefined =>
  (Object.entries(options) as [T, RegExp][]).find(([, re]) => re.test(text))?.[0];

const FREQ = { regularly: /regular|daily|heav|a lot|often/i, socially: /social|sometimes|occasional|light/i, never: /never|no\b|don'?t|non/i } as const;

interface Step {
  question: string;
  parse(answer: string): Parsed;
}

const STEPS: Step[] = [
  {
    question:
      "Let's start with the basics. What should matches call you, when were you born (YYYY-MM-DD), and what is your gender (woman, man or nonbinary)?",
    parse(a) {
      const date = a.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/)?.[0];
      const gender = find(a, { nonbinary: /non-?binary|\bnb\b|enby/i, woman: /\b(woman|female|girl|she)\b/i, man: /\b(man|male|guy|he)\b/i });
      const name = a.split(/[,.;]/)[0].replace(/^(i'?m|i am|my name is|call me)\s+/i, '').trim().split(/\s+/)[0];
      if (!date || !gender || !name) return { error: 'Please give a name, a birth date like 1992-04-10 and your gender.' };
      return { patch: { basic: { displayName: name, birthDate: date, gender } } };
    },
  },
  {
    question:
      'Who would you like to meet (women, men, nonbinary people), what age range (for example 28-40), which city do you live in, and how far away can a partner live (in km)?',
    parse(a) {
      const seeking = (['woman', 'man', 'nonbinary'] as const).filter((g) =>
        g === 'woman' ? /\bwom[ae]n|female|girls?\b/i.test(a) : g === 'man' ? /\b(men|man|male|guys?)\b/i.test(a) : /non-?binary/i.test(a),
      );
      const range = a.match(/\b(\d{2})\s*(?:-|–|to)\s*(\d{2})\b/);
      const city = Object.keys(CITY_COORDS).find((c) => a.toLowerCase().includes(c));
      const km = a.match(/(\d{1,5})\s*km/i)?.[1];
      if (!seeking.length || !range || !city) return { error: 'I need who you want to meet, an age range like 28-40 and your city.' };
      const [lat, lng] = CITY_COORDS[city];
      return {
        patch: {
          basic: {
            seeking: [...seeking],
            ageMin: Math.max(18, Number(range[1])),
            ageMax: Number(range[2]),
            city: city.replace(/\b\w/g, (c) => c.toUpperCase()),
            lat,
            lng,
            radiusKm: km ? Number(km) : 50,
          },
        },
      };
    },
  },
  {
    question:
      'What are you looking for: long-term, marriage, casual, friendship first, or open? Do you have children, do you want (more) children (yes / no / maybe), and how soon do you want something serious (asap, within a year, within 3 years, no rush)?',
    parse(a) {
      const relationshipType = find(a, {
        marriage: /marr/i,
        friendship_first: /friend/i,
        casual: /casual/i,
        long_term: /long|serious|committed/i,
        open: /open|not sure|anything/i,
      });
      const hasChildren = /\b(i have|have (a |two |three )?(kid|child)|my (kid|son|daughter))/i.test(a) && !/\b(no|don'?t have) (kids|children)\b/i.test(a);
      const wantsChildren = find(a, { maybe: /maybe|not sure|open to/i, no: /don'?t want|no more|never want|childfree|child-free/i, yes: /want (kids|children)|yes/i }) ?? 'maybe';
      const timeline = find(a, { asap: /asap|soon as|right away|now/i, within_1y: /1 year|a year|one year/i, within_3y: /3 years|three years|couple of years/i, no_rush: /no rush|whenever|no hurry/i }) ?? 'no_rush';
      if (!relationshipType) return { error: 'Which relationship type fits best: long-term, marriage, casual, friendship first or open?' };
      return { patch: { goals: { relationshipType, hasChildren, wantsChildren, timeline } } };
    },
  },
  {
    question:
      'Lifestyle: smoking and alcohol (never / socially / regularly), exercise (never / sometimes / often / daily), are you an early bird, night owl or flexible, any pets (dog, cat, none, allergic), and would you relocate for a partner (yes / no / maybe)?',
    parse(a) {
      const smokingPart = a.match(/smok[^,.;]*/i)?.[0] ?? '';
      const alcoholPart = a.match(/(alcohol|drink)[^,.;]*/i)?.[0] ?? '';
      const smoking = find(smokingPart, FREQ) ?? (/non-?smok|don'?t smoke/i.test(a) ? 'never' : undefined);
      const alcohol = find(alcoholPart, FREQ);
      const exercise = find(a, { daily: /every ?day|daily/i, often: /often|several|a lot|gym|run/i, sometimes: /sometimes|occasion/i, never: /no (sport|exercise)|never exercise/i });
      const schedule = find(a, { early_bird: /early|morning/i, night_owl: /night|late/i, shift_work: /shift/i, flexible: /flexib/i });
      const pets = find(a, { allergic: /allerg/i, dog: /\bdog/i, cat: /\bcat/i, none: /no pets?|none/i, other: /pet/i });
      const relocation = find(a, { yes: /would (re)?locate|relocate:? yes|move for/i, no: /wouldn'?t|won'?t|not (re)?locate|relocate:? no/i, maybe: /maybe|depends|perhaps/i }) ?? 'maybe';
      const patch: ProfileData = { lifestyle: { smoking, alcohol, exercise, schedule, pets, relocation } };
      for (const k of Object.keys(patch.lifestyle!) as (keyof NonNullable<ProfileData['lifestyle']>)[]) if (!patch.lifestyle![k]) delete patch.lifestyle![k];
      if (Object.keys(patch.lifestyle!).length < 3) return { error: 'Could you tell me a bit more: smoking, drinking, exercise, daily rhythm, pets?' };
      return { patch };
    },
  },
  {
    question: 'On a scale of 1-5, how important are family, career and money to you? (For example: 5 3 2)',
    parse(a) {
      const n = (a.match(/\b[1-5]\b/g) ?? []).map(Number);
      if (n.length < 3) return { error: 'Please give three numbers from 1 to 5, like "5 3 2".' };
      return { patch: { values: { family: n[0], career: n[1], money: n[2] } } };
    },
  },
  {
    question:
      'How would you describe yourself: more direct, diplomatic, playful or reserved? Calm, balanced or energetic? And rate from 0-100 your openness to new things, how organised you are, how sociable, how kind, and how easily you get stressed (for example: 70 60 50 80 30).',
    parse(a) {
      const nums = (a.match(/\b\d{1,3}\b/g) ?? []).map(Number).filter((x) => x <= 100);
      const communicationStyle = find(a, { direct: /direct/i, diplomatic: /diplomat/i, playful: /playful|funny/i, reserved: /reserved|quiet|shy/i }) ?? 'diplomatic';
      const temperament = find(a, { calm: /calm/i, energetic: /energetic|energy/i, balanced: /balanced/i }) ?? 'balanced';
      if (nums.length < 5) return { error: 'Please add five numbers from 0 to 100, like "70 60 50 80 30".' };
      const [openness, conscientiousness, extraversion, agreeableness, neuroticism] = nums;
      return { patch: { personality: { openness, conscientiousness, extraversion, agreeableness, neuroticism, communicationStyle, temperament } } };
    },
  },
  {
    question: 'What do you love doing? List your interests separated by commas, then add a sentence about your ideal weekend.',
    parse(a) {
      const [list, ...rest] = a.split(/[.!?\n]/);
      const interestTags = list
        .split(/,|;| and /)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 1 && t.length <= 40)
        .slice(0, 15);
      if (!interestTags.length) return { error: 'Name a few interests, separated by commas.' };
      return { patch: { interests: { interestTags, interestsText: (rest.join('. ').trim() || list).slice(0, 1000) } } };
    },
  },
  {
    question:
      "Last one: any deal-breakers? For example 'no smokers', 'no heavy drinkers', 'no dogs', 'no cats', 'no partner with kids' - or 'none'.",
    parse(a) {
      return {
        patch: {
          dealBreakers: {
            excludeSmoking: /smok/i.test(a) && !/^none/i.test(a) ? (/heavy|regular/i.test(a) ? ['regularly'] : ['socially', 'regularly']) : [],
            excludeAlcohol: /drink|alcohol/i.test(a) && !/^none/i.test(a) ? ['regularly'] : [],
            excludePets: [...(/\bdogs?\b/i.test(a) ? ['dog' as const] : []), ...(/\bcats?\b/i.test(a) ? ['cat' as const] : [])],
            noPartnerChildren: /(kid|child)/i.test(a) && !/^none/i.test(a),
          },
        },
      };
    },
  },
];

export const SCRIPTED_STEP_COUNT = STEPS.length;

function merge(a: ProfileData, b: ProfileData): ProfileData {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = { ...((a as Record<string, object>)[k] ?? {}), ...(v as object) };
  return out as ProfileData;
}

function strongest(b: ScoreBreakdown | null): string[] {
  if (!b) return [];
  const labels: Record<string, string> = {
    goalsValues: 'relationship goals and values',
    lifestyle: 'lifestyle',
    personality: 'personality',
    interests: 'shared interests',
  };
  return (Object.keys(labels) as (keyof typeof labels)[])
    .sort((x, y) => (b[y as keyof ScoreBreakdown] as number) - (b[x as keyof ScoreBreakdown] as number))
    .slice(0, 2)
    .map((k) => labels[k]);
}

/**
 * Deterministic agent for development and tests (no API key needed).
 * Interview: fixed questions with light parsing. Negotiation: short protocol, verdict by score.
 */
export class ScriptedAgent implements AgentLLM {
  readonly name = 'scripted';
  constructor(private readonly matchThreshold = 60) {}

  async interviewTurn(input: InterviewInput): Promise<InterviewOutput> {
    const step = Number(input.state.step ?? -1);
    const lastUser = [...input.history].reverse().find((t) => t.role === 'user');
    if (step < 0) {
      return {
        reply: `Hi! I'm your AgentMatch agent. I'll ask ${STEPS.length} short questions (about 10 minutes) and then prepare a profile draft for you to review. Nothing is shared until you approve it. ${STEPS[0].question}`,
        done: false,
        state: { step: 0 },
      };
    }
    if (!lastUser) return { reply: STEPS[step].question, done: false, state: input.state };
    const parsed = STEPS[step].parse(lastUser.content);
    if (parsed.error) return { reply: parsed.error, done: false, state: input.state };
    const collected = merge(input.collected, parsed.patch ?? {});
    const next = step + 1;
    if (next < STEPS.length) {
      return { reply: `Got it. ${STEPS[next].question}`, patch: parsed.patch, done: false, state: { step: next } };
    }
    const description = composeDescription(merge(input.current, collected));
    return {
      reply:
        "Thank you! I've written a short description and saved everything as a draft. Please open Profile → Review to check each field, choose who can see it, and approve.",
      patch: { ...parsed.patch, description: { aiDescription: description } },
      done: true,
      state: { step: next },
    };
  }

  async negotiationTurn(i: NegotiationInput): Promise<NegotiationDecision> {
    const sent = i.transcript.filter((t) => t.from === 'you').length;
    const g = i.ownShareable.goals ?? {};
    const card = i.candidate as { goals?: { relationshipType?: string; wantsChildren?: string } };
    const canTalk = i.messagesUsed < i.maxMessages;
    if (sent === 0 && canTalk && !i.ownVerdict) {
      return {
        action: 'message',
        kind: 'greeting',
        content: `Hello! My person is looking for ${g.relationshipType?.replace('_', ' ') ?? 'something meaningful'} and ${
          g.wantsChildren === 'yes' ? 'hopes to have children' : g.wantsChildren === 'no' ? 'does not plan to have children' : 'is open about children'
        }. What matters most to your person in a partner?`,
      };
    }
    if (sent === 1 && canTalk && !i.ownVerdict) {
      const l = i.ownShareable.lifestyle ?? {};
      return {
        action: 'message',
        kind: 'answer',
        content: `Thanks. Day to day my person is ${l.schedule?.replace('_', ' ') ?? 'flexible'}, exercises ${l.exercise ?? 'sometimes'} and enjoys ${
          (i.ownShareable.interests?.interestTags ?? []).slice(0, 3).join(', ') || 'a mix of things'
        }. ${card.goals?.wantsChildren ? '' : 'How does your person feel about children?'}`.trim(),
      };
    }
    const good = i.pairScore >= this.matchThreshold;
    const reasons = strongest(i.scoreForOwner);
    return {
      action: 'verdict',
      verdict: good ? 'match' : 'no_match',
      rationale: good
        ? `Strong fit on ${reasons.join(' and ') || 'overall compatibility'} (score ${Math.round(i.pairScore)}/100) and compatible goals.`
        : `Compatibility too low (score ${Math.round(i.pairScore)}/100) to recommend meeting.`,
    };
  }

  async explainMatch(i: ExplainInput): Promise<string> {
    const card = i.candidate as { age?: number; goals?: { relationshipType?: string }; interests?: { interestTags?: string[] } };
    const reasons = strongest(i.scoreForOwner);
    const tags = card.interests?.interestTags?.slice(0, 3) ?? [];
    return [
      `Both agents recommend this match (compatibility ${Math.round(i.pairScore)}/100).`,
      reasons.length ? `You fit especially well on ${reasons.join(' and ')}.` : '',
      card.goals?.relationshipType ? `They are also looking for ${card.goals.relationshipType.replace('_', ' ')}.` : '',
      tags.length ? `Possible first-date topics: ${tags.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }
}
