import { z } from 'zod';
import { FIELD_DEFS, FieldDef, SECTION_KEYS, SECTION_SCHEMAS, SectionKey, VISIBILITY_LEVELS, Visibility } from '@agentmatch/shared';

export interface FieldSpec extends FieldDef {
  kind: 'enum' | 'multi' | 'tags' | 'bool' | 'number' | 'date' | 'text' | 'longtext';
  options?: string[];
  min?: number;
  max?: number;
}

type JsonProp = { type?: string; enum?: string[]; items?: { enum?: string[]; type?: string }; minimum?: number; maximum?: number; pattern?: string };

const LONG = new Set(['aiDescription', 'interestsText']);

/** Field metadata for editors, derived from the shared zod schemas. */
export const FIELD_SPECS: FieldSpec[] = SECTION_KEYS.flatMap((section: SectionKey) => {
  const props = (z.toJSONSchema(SECTION_SCHEMAS[section], { unrepresentable: 'any' }) as { properties: Record<string, JsonProp> }).properties;
  return FIELD_DEFS.filter((f) => f.section === section).map((f) => {
    const p = props[f.key] ?? {};
    let kind: FieldSpec['kind'] = 'text';
    if (p.enum) kind = 'enum';
    else if (p.type === 'array') kind = p.items?.enum ? 'multi' : 'tags';
    else if (p.type === 'boolean') kind = 'bool';
    else if (p.type === 'number' || p.type === 'integer') kind = 'number';
    else if (f.key === 'birthDate') kind = 'date';
    else if (LONG.has(f.key)) kind = 'longtext';
    return { ...f, kind, options: p.enum ?? p.items?.enum, min: p.minimum, max: p.maximum };
  });
});

export function allowedVisibility(f: FieldDef): Visibility[] {
  const lo = VISIBILITY_LEVELS.indexOf(f.minVisibility);
  const hi = VISIBILITY_LEVELS.indexOf(f.maxVisibility);
  return VISIBILITY_LEVELS.slice(lo, hi + 1) as Visibility[];
}

export type ProfileValues = Record<string, Record<string, unknown>>;

export function getValue(data: ProfileValues, f: FieldDef): unknown {
  return data[f.section]?.[f.key];
}

export function formatValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  const s = String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}
