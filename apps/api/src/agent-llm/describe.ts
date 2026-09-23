import { ProfileData, wordCount } from '@agentmatch/shared';

const REL: Record<string, string> = {
  long_term: 'a long-term relationship built on trust and everyday kindness',
  marriage: 'a committed partnership that could lead to marriage',
  friendship_first: 'a connection that starts as friendship and grows slowly',
  open: 'whatever feels right with the right person',
  casual: 'something light and easy-going',
};

/**
 * Template description (150-300 words) used by the scripted agent when no LLM is
 * configured. Uses pronouns only, never the name.
 */
export function composeDescription(d: ProfileData): string {
  const g = d.basic?.gender;
  const they = g === 'woman' ? 'She' : g === 'man' ? 'He' : 'They';
  const their = g === 'woman' ? 'her' : g === 'man' ? 'his' : 'their';
  const s = they === 'They' ? '' : 's';
  const is = they === 'They' ? 'are' : 'is';
  const tags = d.interests?.interestTags ?? [];
  const l = d.lifestyle ?? {};
  const p = d.personality ?? {};
  const parts = [
    `${they} live${s} in ${d.basic?.city ?? 'the city'} and ${is} looking for ${REL[d.goals?.relationshipType ?? 'open']}.`,
    tags.length ? `${they} light${s} up when talking about ${tags.slice(0, 4).join(', ')}${tags.length > 4 ? ` and ${tags.slice(4, 6).join(', ')}` : ''}.` : '',
    d.interests?.interestsText ? `In ${their} own words: ${d.interests.interestsText.trim().replace(/\.?$/, '.')}` : '',
    d.goals?.wantsChildren === 'yes'
      ? `Family matters: ${they.toLowerCase()} would like to raise children one day.`
      : d.goals?.wantsChildren === 'no'
        ? `${they} ${is} clear that children are not part of ${their} plans.`
        : `${they} ${is} still open about having children.`,
    l.schedule === 'early_bird'
      ? `Mornings are ${their} favourite time of day.`
      : l.schedule === 'night_owl'
        ? `${they} come${s} alive in the evening.`
        : `${they} keep${s} a flexible rhythm.`,
    l.exercise ? `Exercise happens ${l.exercise === 'daily' ? 'every day' : l.exercise === 'often' ? 'several times a week' : l.exercise === 'sometimes' ? 'now and then' : 'rarely'}.` : '',
    l.pets && l.pets !== 'none' ? (l.pets === 'allergic' ? `Pets are tricky because of an allergy.` : `A ${l.pets === 'other' ? 'pet' : l.pets} is part of daily life.`) : '',
    p.communicationStyle ? `Friends would call ${their} communication style ${p.communicationStyle} and ${their} temperament ${p.temperament ?? 'balanced'}.` : '',
    `${they} value${s} honesty, curiosity and people who follow through on what they say.`,
    `Small things matter: remembering details, making time for each other, and laughing at the same absurd moments.`,
    `${they} believe${s} that good relationships are built on patience, generosity and a shared sense of direction, and that the best conversations happen on long walks or over a slow dinner.`,
    `${they} ${is} happiest when life mixes routine with a little adventure, whether that is a weekend trip, a new recipe or an unplanned evening out with close friends.`,
    `A good first date would be relaxed and unhurried: a walk, a coffee or a small exhibition, with plenty of room to talk and see whether the conversation keeps flowing.`,
    `${they} ${is} ready to meet someone kind, emotionally available and curious about the world, someone who wants to build something real together at a comfortable pace.`,
    `Reliability and warmth count for more than grand gestures, and ${they.toLowerCase()} appreciate${s} people who are direct about what they want.`,
  ].filter(Boolean);
  let text = '';
  for (const part of parts) {
    if (wordCount(text) >= 190) break;
    text = `${text} ${part}`.trim();
  }
  return text;
}
