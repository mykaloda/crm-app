import { distanceBucket, orderPair, scrubName } from './matching.service';

describe('candidate card helpers', () => {
  it('scrubs the name from agent-facing text', () => {
    expect(scrubName('Elias loves chess. ELIAS cooks. Eliasson is a surname.', 'Elias')).toBe(
      'this person loves chess. this person cooks. Eliasson is a surname.',
    );
    expect(scrubName('Anna (a.k.a. Ann) smiles', 'Ann')).toBe('Anna (a.k.a. this person) smiles');
    expect(scrubName('text', null)).toBe('text');
  });

  it('buckets distance', () => {
    expect(distanceBucket(0.5)).toBe('under 2 km');
    expect(distanceBucket(3)).toBe('about 5 km');
    expect(distanceBucket(12.3)).toBe('about 15 km');
  });

  it('orders pairs deterministically', () => {
    expect(orderPair('b', 'a')).toEqual(['a', 'b']);
    expect(orderPair('a', 'b')).toEqual(['a', 'b']);
  });
});
