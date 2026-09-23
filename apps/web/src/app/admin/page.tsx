'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, PageTitle, Spinner, useGuard } from '@/components/ui';
import { API_URL, get, post, put } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type Tab = 'metrics' | 'users' | 'reports' | 'photos' | 'algorithm';
type Ratio = { numerator: number; denominator: number; value: number | null; definition: string };

function pct(r: Ratio) {
  return r.value === null ? '—' : `${(r.value * 100).toFixed(1)}%`;
}

function Metrics() {
  const [m, setM] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<Record<string, unknown>>('/admin/metrics').then(setM, setError);
  }, []);
  if (!m) return error ? <ErrorNote error={error} /> : <Spinner />;
  const ratios = ['profileCompletion', 'aiConnected', 'mutualPerPresentation', 'chats10Plus', 'metRate', 'subscriptionConversion', 'd30Retention'];
  const rating = m.averageRating as { value: number | null; count: number; definition: string };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card">
          <p className="label">Users</p>
          <p className="text-2xl font-semibold">{m.users as number}</p>
        </div>
        {ratios.map((k) => {
          const r = m[k] as Ratio;
          return (
            <div key={k} className="card" title={r.definition}>
              <p className="label">{k}</p>
              <p className="text-2xl font-semibold">{pct(r)}</p>
              <p className="text-xs text-black/40">
                {r.numerator} / {r.denominator} · {r.definition}
              </p>
            </div>
          );
        })}
        <div className="card">
          <p className="label">averageRating</p>
          <p className="text-2xl font-semibold">{rating.value ?? '—'}</p>
          <p className="text-xs text-black/40">n={rating.count} · {rating.definition}</p>
        </div>
      </div>
      <div className="card">
        <p className="label">Match funnel</p>
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(m.matchFunnel as Record<string, number>).map(([k, v]) => (
            <span key={k} className="chip">
              {k}: {v}
            </span>
          ))}
        </div>
      </div>
      <div className="card">
        <p className="label">Feedback by score bucket (for weight tuning)</p>
        <table className="w-full text-sm">
          <tbody>
            {(m.feedbackByScore as { bucket: number; matches: number; avg_rating: number | null; met: number }[]).map((r) => (
              <tr key={r.bucket} className="border-t border-black/5">
                <td className="py-1">{r.bucket}–{r.bucket + 9}</td>
                <td>{r.matches} matches</td>
                <td>avg ★ {r.avg_rating?.toFixed(2) ?? '—'}</td>
                <td>met {r.met}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AdminUser {
  id: string;
  email: string;
  role: string;
  status: string;
  aiEnabled: boolean;
  reports: number;
  profile: { displayName: string | null; status: string; completeness: number; city: string | null } | null;
}

function Users() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ total: number; users: AdminUser[] } | null>(null);
  const load = useCallback(() => get<{ total: number; users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`).then(setData), [q]);
  useEffect(() => {
    void load();
  }, [load]);
  const setStatus = (id: string, status: string) => post(`/admin/users/${id}/status`, { status }).then(load);
  return (
    <div className="space-y-3">
      <input className="input" placeholder={t('admin.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {!data ? (
        <Spinner />
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {data.users.map((u) => (
              <tr key={u.id} className="border-t border-black/5">
                <td className="py-2">
                  <p>{u.email}</p>
                  <p className="text-xs text-black/40">
                    {u.profile?.displayName} · {u.profile?.city} · {u.profile?.status} {u.profile?.completeness}% · {u.role}
                  </p>
                </td>
                <td>{u.reports > 0 && <span className="chip bg-red-100 text-red-800">{u.reports} reports</span>}</td>
                <td><span className="chip">{u.status}</span></td>
                <td className="space-x-1 text-right">
                  {u.status === 'ACTIVE' ? (
                    <>
                      <button className="btn-ghost" onClick={() => setStatus(u.id, 'SUSPENDED')}>{t('admin.suspend')}</button>
                      <button className="btn-danger" onClick={() => setStatus(u.id, 'BANNED')}>{t('admin.ban')}</button>
                    </>
                  ) : (
                    <button className="btn-ghost" onClick={() => setStatus(u.id, 'ACTIVE')}>{t('admin.activate')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface ReportRow {
  id: string;
  reason: string;
  details: string | null;
  createdAt: string;
  target: { id: string; email: string; status: string; profile: { displayName: string | null } | null };
  reporter: { email: string };
  recentChat: { senderId: string; body: string }[];
}

function Reports() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const load = useCallback(() => get<ReportRow[]>('/admin/reports').then(setRows), []);
  useEffect(() => {
    void load();
  }, [load]);
  const resolve = (id: string, action: string) => post(`/admin/reports/${id}/resolve`, { action }).then(load);
  if (!rows) return <Spinner />;
  if (!rows.length) return <p className="text-sm text-black/50">{t('common.none')}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="card space-y-2 text-sm">
          <p>
            <b>{r.reason}</b> — {r.target.email} ({r.target.profile?.displayName}) · by {r.reporter.email}
          </p>
          {r.details && <p className="text-black/60">{r.details}</p>}
          {r.recentChat.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs text-black/50">chat ({r.recentChat.length})</summary>
              <ul className="mt-1 space-y-0.5 text-xs">
                {r.recentChat.map((c, i) => (
                  <li key={i}>
                    <b>{c.senderId === r.target.id ? 'reported' : 'reporter'}:</b> {c.body}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => resolve(r.id, 'dismiss')}>{t('admin.dismiss')}</button>
            <button className="btn-ghost" onClick={() => resolve(r.id, 'suspend')}>{t('admin.suspend')}</button>
            <button className="btn-danger" onClick={() => resolve(r.id, 'ban')}>{t('admin.ban')}</button>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Photos() {
  const [rows, setRows] = useState<{ id: string; moderation: string }[] | null>(null);
  const load = useCallback(() => get<{ id: string; moderation: string }[]>('/admin/photos?moderation=APPROVED').then(setRows), []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!rows) return <Spinner />;
  return (
    <div className="grid grid-cols-3 gap-3">
      {rows.map((p) => (
        <div key={p.id} className="space-y-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${API_URL}/photos/${p.id}`} alt="" className="aspect-square w-full rounded-xl object-cover" />
          <button className="btn-danger w-full" onClick={() => post(`/admin/photos/${p.id}`, { moderation: 'REJECTED' }).then(load)}>Reject</button>
        </div>
      ))}
    </div>
  );
}

const WEIGHT_KEYS = ['goalsValues', 'lifestyle', 'personality', 'interests', 'activity'] as const;

function Algorithm() {
  const { t } = useI18n();
  const [cfg, setCfg] = useState<Record<string, unknown> & { weights: Record<string, number> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    get<typeof cfg>('/admin/algorithm').then(setCfg, setError);
  }, []);
  if (!cfg) return error ? <ErrorNote error={error} /> : <Spinner />;
  const num = (k: string) => (
    <div key={k}>
      <label className="label">{k}</label>
      <input className="input" type="number" value={cfg[k] as number} onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })} />
    </div>
  );
  return (
    <div className="card space-y-4">
      <p className="text-sm text-black/60">{t('admin.weightsHint')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {WEIGHT_KEYS.map((k) => (
          <div key={k}>
            <label className="label">{t(`breakdown.${k}`)}</label>
            <input className="input" type="number" min={0} max={100} value={cfg.weights[k]} onChange={(e) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: Number(e.target.value) } })} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{['vectorTopK', 'negotiationTopN', 'minScore', 'dailyMatchesFree', 'dailyMatchesPremium'].map(num)}</div>
      <ErrorNote error={error} />
      <button
        className="btn-primary"
        onClick={() =>
          put('/admin/algorithm', cfg).then(() => {
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }, setError)
        }
      >
        {saved ? '✓' : t('common.save')}
      </button>
    </div>
  );
}

export default function Admin() {
  const { me } = useGuard({ staff: true });
  const { t } = useI18n();
  const tabs: Tab[] = me?.role === 'ADMIN' ? ['metrics', 'users', 'reports', 'photos', 'algorithm'] : ['users', 'reports', 'photos'];
  const [tab, setTab] = useState<Tab | null>(null);
  if (!me) return <Spinner />;
  const active = tab ?? tabs[0];
  return (
    <div>
      <PageTitle>{t('admin.title')}</PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((k) => (
          <button key={k} className={active === k ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab(k)}>
            {t(`admin.${k}`)}
          </button>
        ))}
      </div>
      {active === 'metrics' && <Metrics />}
      {active === 'users' && <Users />}
      {active === 'reports' && <Reports />}
      {active === 'photos' && <Photos />}
      {active === 'algorithm' && <Algorithm />}
    </div>
  );
}
