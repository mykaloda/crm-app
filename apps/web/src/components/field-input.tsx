'use client';
import { FieldSpec } from '@/lib/fields';
import { humanize, useI18n } from '@/lib/i18n';

export function FieldInput({ spec, value, onChange }: { spec: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useI18n();
  switch (spec.kind) {
    case 'enum':
      return (
        <select className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">—</option>
          {spec.options!.map((o) => (
            <option key={o} value={o}>{humanize(o)}</option>
          ))}
        </select>
      );
    case 'multi': {
      const arr = (value as string[]) ?? [];
      return (
        <div className="flex flex-wrap gap-2">
          {spec.options!.map((o) => (
            <label key={o} className={`chip cursor-pointer ${arr.includes(o) ? 'bg-brand-100 text-brand-700' : ''}`}>
              <input type="checkbox" className="hidden" checked={arr.includes(o)} onChange={(e) => onChange(e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
              {humanize(o)}
            </label>
          ))}
        </div>
      );
    }
    case 'tags':
      return (
        <input
          className="input"
          defaultValue={((value as string[]) ?? []).join(', ')}
          onBlur={(e) => onChange(e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))}
        />
      );
    case 'bool':
      return (
        <select className="input" value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value === 'true')}>
          <option value="">—</option>
          <option value="true">{t('common.yes')}</option>
          <option value="false">{t('common.no')}</option>
        </select>
      );
    case 'number':
      return (
        <input
          className="input"
          type="number"
          min={spec.min}
          max={spec.max}
          step={spec.key === 'lat' || spec.key === 'lng' ? 'any' : 1}
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'date':
      return <input className="input" type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />;
    case 'longtext':
      return <textarea className="input min-h-32" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className="input" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value)} />;
  }
}
