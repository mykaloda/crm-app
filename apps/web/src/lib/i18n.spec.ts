import { DICTIONARIES, en, ru } from './dictionaries';
import { humanize, translate } from './i18n';

describe('i18n', () => {
  it('every locale has exactly the English keys', () => {
    for (const dict of Object.values(DICTIONARIES)) expect(Object.keys(dict).sort()).toEqual(Object.keys(en).sort());
  });
  it('keeps placeholders in translations', () => {
    for (const [k, v] of Object.entries(en)) {
      const vars = v.match(/\{\w+\}/g) ?? [];
      for (const p of vars) expect(ru[k as keyof typeof en]).toContain(p);
    }
  });
  it('interpolates', () => {
    expect(translate('en', 'matches.quota', { n: 5 })).toBe('Up to 5 a day');
    expect(translate('ru', 'matches.age', { n: 30 })).toBe('30 лет');
  });
  it('humanizes enum values', () => {
    expect(humanize('long_term')).toBe('Long term');
    expect(humanize('interestTags')).toBe('Interest tags');
  });
});
