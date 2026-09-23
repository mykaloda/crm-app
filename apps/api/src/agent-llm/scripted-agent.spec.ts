import { profileCompleteness, profileDataSchema, wordCount } from '@agentmatch/shared';
import { ChatTurn } from './agent-llm';
import { composeDescription } from './describe';
import { SCRIPTED_STEP_COUNT, ScriptedAgent } from './scripted-agent';

const ANSWERS = [
  "I'm Alex, born 1992-04-10, woman",
  'I want to meet men, 28-40, I live in Berlin, up to 40 km',
  'Long-term, no kids yet, I want children, within a year',
  'Smoking never, alcohol socially, I exercise often, early bird, I have a dog, relocate maybe',
  '5 3 2',
  'Direct and calm. 70 60 50 80 30',
  'hiking, cooking, books, jazz. Weekends are for long walks and slow dinners.',
  'no smokers',
];

describe('ScriptedAgent interview', () => {
  it('walks all steps and produces a valid, complete profile', async () => {
    const agent = new ScriptedAgent();
    const history: ChatTurn[] = [];
    let state: Record<string, unknown> = {};
    let collected: Record<string, Record<string, unknown>> = {};
    let out = await agent.interviewTurn({ history, collected, current: {}, sensitiveConsent: false, state, locale: 'en' });
    state = out.state;
    history.push({ role: 'assistant', content: out.reply });
    expect(ANSWERS).toHaveLength(SCRIPTED_STEP_COUNT);
    for (const answer of ANSWERS) {
      history.push({ role: 'user', content: answer });
      out = await agent.interviewTurn({ history, collected, current: {}, sensitiveConsent: false, state, locale: 'en' });
      expect(out.reply).not.toMatch(/^Please|^I need|^Could you/);
      for (const [k, v] of Object.entries(out.patch ?? {})) collected[k] = { ...(collected[k] ?? {}), ...(v as object) };
      state = out.state;
      history.push({ role: 'assistant', content: out.reply });
    }
    expect(out.done).toBe(true);
    const data = profileDataSchema.parse(collected);
    expect(data.basic).toMatchObject({ displayName: 'Alex', gender: 'woman', seeking: ['man'], ageMin: 28, ageMax: 40, city: 'Berlin', radiusKm: 40 });
    expect(data.goals).toEqual({ relationshipType: 'long_term', hasChildren: false, wantsChildren: 'yes', timeline: 'within_1y' });
    expect(data.lifestyle).toMatchObject({ smoking: 'never', alcohol: 'socially', schedule: 'early_bird', pets: 'dog' });
    expect(data.dealBreakers?.excludeSmoking).toEqual(['socially', 'regularly']);
    expect(profileCompleteness(data)).toBe(100);
    expect(data.description?.aiDescription).not.toContain('Alex');
  });

  it('re-asks when an answer cannot be parsed', async () => {
    const agent = new ScriptedAgent();
    const out = await agent.interviewTurn({
      history: [{ role: 'assistant', content: 'q' }, { role: 'user', content: 'hello' }],
      collected: {},
      current: {},
      sensitiveConsent: false,
      state: { step: 0 },
      locale: 'en',
    });
    expect(out.patch).toBeUndefined();
    expect(out.state).toEqual({ step: 0 });
  });
});

describe('ScriptedAgent negotiation', () => {
  const base = { ownShareable: { goals: { relationshipType: 'long_term' as const } }, candidate: {}, scoreForOwner: null, messagesUsed: 0, maxMessages: 10, ownVerdict: null, counterpartHasVerdict: false };
  it('greets, answers, then decides by score', async () => {
    const a = new ScriptedAgent(60);
    expect((await a.negotiationTurn({ ...base, pairScore: 80, transcript: [] })).action).toBe('message');
    const t1 = [{ from: 'you' as const, kind: 'greeting', content: 'hi' }];
    expect((await a.negotiationTurn({ ...base, pairScore: 80, transcript: t1 })).action).toBe('message');
    const t2 = [...t1, { from: 'you' as const, kind: 'answer', content: 'x' }];
    expect(await a.negotiationTurn({ ...base, pairScore: 80, transcript: t2 })).toMatchObject({ action: 'verdict', verdict: 'match' });
    expect(await a.negotiationTurn({ ...base, pairScore: 40, transcript: t2 })).toMatchObject({ action: 'verdict', verdict: 'no_match' });
  });
});

describe('composeDescription', () => {
  it('writes 150-300 words without the name', () => {
    const d = composeDescription({ basic: { displayName: 'Zed', gender: 'man', city: 'Munich' }, interests: { interestTags: ['chess'] } });
    expect(wordCount(d)).toBeGreaterThanOrEqual(150);
    expect(wordCount(d)).toBeLessThanOrEqual(300);
    expect(d).not.toContain('Zed');
  });
});
