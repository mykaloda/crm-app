import { FIELD_DEFS } from '@agentmatch/shared';
import { FIELD_SPECS, allowedVisibility, formatValue } from './fields';

describe('field specs', () => {
  const byKey = Object.fromEntries(FIELD_SPECS.map((f) => [f.key, f]));
  it('covers every profile field with a sensible editor', () => {
    expect(FIELD_SPECS).toHaveLength(FIELD_DEFS.length);
    expect(byKey.smoking).toMatchObject({ kind: 'enum', options: ['never', 'socially', 'regularly'] });
    expect(byKey.seeking.kind).toBe('multi');
    expect(byKey.interestTags.kind).toBe('tags');
    expect(byKey.hasChildren.kind).toBe('bool');
    expect(byKey.openness).toMatchObject({ kind: 'number', min: 0, max: 100 });
    expect(byKey.birthDate.kind).toBe('date');
    expect(byKey.aiDescription.kind).toBe('longtext');
  });
  it('limits visibility choices', () => {
    expect(allowedVisibility(byKey.lat)).toEqual(['algorithm_only']);
    expect(allowedVisibility(byKey.openness)).toEqual(['hidden', 'algorithm_only', 'agents', 'people']);
    expect(allowedVisibility(byKey.gender)).toEqual(['algorithm_only', 'agents', 'people']);
  });
  it('formats values', () => {
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue(undefined)).toBe('—');
    expect(formatValue(true)).toBe('✓');
  });
});
