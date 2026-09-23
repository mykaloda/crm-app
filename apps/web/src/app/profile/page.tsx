'use client';
import { useCallback, useEffect, useState } from 'react';
import { SECTION_KEYS, SectionKey, Visibility, wordCount } from '@agentmatch/shared';
import { FieldInput } from '@/components/field-input';
import { ErrorNote, PageTitle, Spinner, useGuard } from '@/components/ui';
import { API_URL, api, del, get, post, put } from '@/lib/api';
import { FIELD_SPECS, ProfileValues, allowedVisibility, formatValue, getValue } from '@/lib/fields';
import { coordsFor } from '@/lib/cities';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

interface Draft {
  id: string;
  source: string;
  note: string | null;
  patch: ProfileValues;
  createdAt: string;
}
interface ProfileView {
  status: string;
  completeness: number;
  data: ProfileValues;
  visibility: Record<string, Visibility>;
  missing: string[];
  drafts: Draft[];
  photos: { id: string; position: number; moderation: string }[];
}

function DraftCard({ draft, current, onDone }: { draft: Draft; current: ProfileValues; onDone: () => void }) {
  const { t, field } = useI18n();
  const [patch, setPatch] = useState<ProfileValues>(draft.patch);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const changes = FIELD_SPECS.filter((f) => patch[f.section]?.[f.key] !== undefined);
  async function act(approve: boolean) {
    try {
      if (approve) await post(`/profile/drafts/${draft.id}/approve`, editing ? { patch } : {});
      else await post(`/profile/drafts/${draft.id}/reject`);
      onDone();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="card space-y-3 ring-brand-100">
      <div className="flex items-center justify-between text-sm">
        <span className="chip bg-brand-50 text-brand-700">{t(`profile.source.${draft.source}` as never)}</span>
        <span className="text-black/40">{new Date(draft.createdAt).toLocaleString()}</span>
      </div>
      {draft.note && <p className="text-sm italic text-black/60">“{draft.note}”</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-black/40">
            <th className="py-1 pr-4 font-normal" />
            <th className="py-1 pr-4 font-normal">{t('profile.current')}</th>
            <th className="py-1 font-normal">{t('profile.proposed')}</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((f) => (
            <tr key={f.key} className="border-t border-black/5 align-top">
              <td className="py-2 pr-2 font-medium">{field(f.key)}</td>
              <td className="py-2 pr-2 text-black/50">{formatValue(getValue(current, f))}</td>
              <td className="py-2">
                {editing ? (
                  <FieldInput spec={f} value={patch[f.section]?.[f.key]} onChange={(v) => setPatch({ ...patch, [f.section]: { ...patch[f.section], [f.key]: v } })} />
                ) : (
                  formatValue(patch[f.section]?.[f.key])
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorNote error={error} />
      <div className="flex gap-2">
        <button className="btn-primary" onClick={() => act(true)}>{t('common.approve')}</button>
        <button className="btn-ghost" onClick={() => setEditing(!editing)}>{t('common.edit')}</button>
        <button className="btn-ghost" onClick={() => act(false)}>{t('common.reject')}</button>
      </div>
    </div>
  );
}

function SectionEditor({ section, view, sensitive, onSaved }: { section: SectionKey; view: ProfileView; sensitive: boolean; onSaved: () => void }) {
  const { t, field } = useI18n();
  const specs = FIELD_SPECS.filter((f) => f.section === section && (sensitive || !f.sensitive) && f.key !== 'lat' && f.key !== 'lng');
  const [values, setValues] = useState<Record<string, unknown>>(view.data[section] ?? {});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  async function save() {
    setError(null);
    try {
      const clean: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== ''));
      const coords = section === 'basic' ? coordsFor(clean.city) : undefined;
      if (coords) [clean.lat, clean.lng] = coords;
      await put('/profile', { [section]: clean });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
    } catch (e) {
      setError(e);
    }
  }
  async function setVis(key: string, v: string) {
    await put('/profile/visibility', { [key]: v });
    onSaved();
  }
  return (
    <details className="card" open={section === 'basic'}>
      <summary className="cursor-pointer font-medium">{t(`profile.section.${section}` as never)}</summary>
      <div className="mt-4 space-y-4">
        {specs.map((f) => (
          <div key={f.key} className="grid gap-2 sm:grid-cols-[1fr_12rem]">
            <div>
              <label className="label">
                {field(f.key)}
                {f.required && ' *'}
              </label>
              <FieldInput spec={f} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} />
              {f.key === 'aiDescription' && <p className="mt-1 text-xs text-black/40">{wordCount(values[f.key] as string)} / 150–300</p>}
            </div>
            <div>
              <label className="label">{t('profile.visibility')}</label>
              <select className="input" value={view.visibility[f.key]} onChange={(e) => setVis(f.key, e.target.value)} disabled={allowedVisibility(f).length < 2}>
                {allowedVisibility(f).map((v) => (
                  <option key={v} value={v}>{t(`profile.vis.${v}` as never)}</option>
                ))}
              </select>
            </div>
          </div>
        ))}
        {section === 'basic' && (
          <p className="text-xs text-black/40">
            {field('lat')}/{field('lng')}: {formatValue(view.data.basic?.lat)}, {formatValue(view.data.basic?.lng)} — {t('profile.vis.algorithm_only')}
          </p>
        )}
        <ErrorNote error={error} />
        <button className="btn-primary" onClick={save}>{saved ? t('profile.saved') : t('common.save')}</button>
      </div>
    </details>
  );
}

export default function Profile() {
  const { ready } = useGuard();
  const { me, reload: reloadMe } = useMe();
  const { t, field } = useI18n();
  const [view, setView] = useState<ProfileView | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    setView(await get<ProfileView>('/profile'));
    setVersion((v) => v + 1);
    void reloadMe();
  }, [reloadMe]);
  useEffect(() => {
    if (ready) load().catch(setError);
  }, [ready, load]);

  async function upload(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      await api('/profile/photos', { method: 'POST', body: fd });
      await load();
    } catch (e) {
      setError(e);
    }
  }

  if (!view) return error ? <ErrorNote error={error} /> : <Spinner />;
  const sensitive = !!me?.consents.includes('SENSITIVE_DATA');
  return (
    <div className="space-y-6">
      <PageTitle>{t('profile.title')}</PageTitle>
      <div className="card flex flex-wrap items-center gap-6">
        <div>
          <p className="label">{t('profile.status')}</p>
          <p className="font-medium">{view.status}</p>
        </div>
        <div className="flex-1">
          <p className="label">{t('profile.completeness')}</p>
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div className="h-full bg-brand-500" style={{ width: `${view.completeness}%` }} />
          </div>
        </div>
        {view.status !== 'INCOMPLETE' && (
          <button className="btn-ghost" onClick={() => post('/profile/pause', { paused: view.status !== 'PAUSED' }).then(load)}>
            {view.status === 'PAUSED' ? t('profile.resume') : t('profile.pause')}
          </button>
        )}
        {view.missing.length > 0 && (
          <p className="w-full text-sm text-amber-700">
            {t('profile.missing')}: {view.missing.map(field).join(', ')}
          </p>
        )}
      </div>

      {view.drafts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('profile.drafts')}</h2>
          <p className="text-sm text-black/60">{t('profile.draftsHint')}</p>
          {view.drafts.map((d) => (
            <DraftCard key={d.id} draft={d} current={view.data} onDone={load} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('profile.fields')}</h2>
        {SECTION_KEYS.map((s) => (
          <SectionEditor key={`${s}-${version}`} section={s} view={view} sensitive={sensitive} onSaved={load} />
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t('profile.photos')}</h2>
        <p className="text-sm text-black/60">{t('profile.photosHint')}</p>
        <div className="grid grid-cols-3 gap-3">
          {view.photos.map((p) => (
            <div key={p.id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${API_URL}/photos/${p.id}`} alt="" className="aspect-square w-full rounded-xl object-cover" />
              <button className="absolute right-1 top-1 rounded-full bg-white/90 px-2 text-sm" onClick={() => del(`/profile/photos/${p.id}`).then(load)}>×</button>
            </div>
          ))}
        </div>
        {view.photos.length < 6 && (
          <label className="btn-ghost cursor-pointer">
            {t('profile.upload')}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        )}
        <ErrorNote error={error} />
      </section>
    </div>
  );
}
