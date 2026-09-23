'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ErrorNote, PageTitle, Score, Spinner, useGuard } from '@/components/ui';
import { API_URL, get, post } from '@/lib/api';
import { humanize, useI18n } from '@/lib/i18n';

const DISCLOSABLE = ['displayName', 'age', 'city', 'photos', 'description', 'interests'] as const;

interface MatchView {
  matchId: string;
  status: string;
  score: number;
  explanation: string | null;
  card: {
    age?: number;
    approximateDistance?: string;
    goals?: Record<string, unknown>;
    lifestyle?: Record<string, unknown>;
    interests?: { interestTags?: string[]; interestsText?: string };
    description?: string;
  };
  breakdown: Record<string, number> | null;
  yourDecision: 'LIKE' | 'PASS' | null;
  person?: { displayName?: string; age?: number; city?: string; photoIds: string[]; interests?: string[]; description?: string };
}

function MatchCard({ m, onChange }: { m: MatchView; onChange: () => void }) {
  const { t } = useI18n();
  const [choosing, setChoosing] = useState(false);
  const [disclose, setDisclose] = useState<string[]>(['displayName', 'age', 'photos']);
  const [error, setError] = useState<unknown>(null);
  async function decide(decision: 'LIKE' | 'PASS') {
    try {
      await post(`/matches/${m.matchId}/decision`, { decision, disclose: decision === 'LIKE' ? disclose : [] });
      setChoosing(false);
      onChange();
    } catch (e) {
      setError(e);
    }
  }
  const tags = m.card.interests?.interestTags ?? [];
  return (
    <article className="card space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold">
            {m.person?.displayName ?? (m.card.age ? t('matches.age', { n: m.card.age }) : '—')}
            {m.person?.city && <span className="ml-2 text-sm font-normal text-black/50">{m.person.city}</span>}
          </h3>
          <p className="text-sm text-black/50">{[m.card.approximateDistance, m.card.goals?.relationshipType && humanize(String(m.card.goals.relationshipType))].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right">
          <p className="label">{t('matches.score')}</p>
          <Score value={m.score} />
        </div>
      </div>
      {m.person && m.person.photoIds.length > 0 && (
        <div className="flex gap-2 overflow-x-auto">
          {m.person.photoIds.map((id) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={id} src={`${API_URL}/photos/${id}`} alt="" className="size-28 rounded-xl object-cover" />
          ))}
        </div>
      )}
      {m.explanation && (
        <div className="rounded-xl bg-brand-50 p-3 text-sm">
          <p className="label text-brand-700">{t('matches.why')}</p>
          {m.explanation}
        </div>
      )}
      {m.card.description && <p className="text-sm text-black/70">{m.card.description}</p>}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="chip">{tag}</span>
          ))}
        </div>
      )}
      {m.breakdown && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          {(['goalsValues', 'lifestyle', 'personality', 'interests', 'activity'] as const).map((k) => (
            <div key={k} className="flex items-center justify-between gap-2">
              <span className="text-black/50">{t(`breakdown.${k}`)}</span>
              <Score value={m.breakdown![k]} />
            </div>
          ))}
        </div>
      )}
      <ErrorNote error={error} />
      {m.status === 'MUTUAL' ? (
        <div className="flex flex-wrap gap-2">
          <span className="chip bg-emerald-100 text-emerald-800">{t('matches.mutual')}</span>
          <Link href={`/chats/${m.matchId}`} className="btn-primary">{t('matches.openChat')}</Link>
          <Link href={`/matches/${m.matchId}/feedback`} className="btn-ghost">{t('matches.feedback')}</Link>
        </div>
      ) : m.yourDecision === 'LIKE' ? (
        <p className="text-sm text-black/60">{t('matches.liked')}</p>
      ) : choosing ? (
        <div className="space-y-3 rounded-xl border border-brand-100 p-3">
          <p className="font-medium">{t('matches.discloseTitle')}</p>
          <p className="text-xs text-black/50">{t('matches.discloseHint')}</p>
          <div className="flex flex-wrap gap-2">
            {DISCLOSABLE.map((f) => (
              <label key={f} className={`chip cursor-pointer ${disclose.includes(f) ? 'bg-brand-100 text-brand-700' : ''}`}>
                <input type="checkbox" className="hidden" checked={disclose.includes(f)} onChange={(e) => setDisclose(e.target.checked ? [...disclose, f] : disclose.filter((x) => x !== f))} />
                {t(`matches.disclose.${f}`)}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={!disclose.length} onClick={() => decide('LIKE')}>{t('matches.confirmLike')}</button>
            <button className="btn-ghost" onClick={() => setChoosing(false)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button className="btn-primary" onClick={() => setChoosing(true)}>♥ {t('matches.like')}</button>
          <button className="btn-ghost" onClick={() => decide('PASS')}>{t('matches.pass')}</button>
        </div>
      )}
    </article>
  );
}

export default function Matches() {
  const { ready } = useGuard();
  const { t } = useI18n();
  const [today, setToday] = useState<{ quota: number; matches: MatchView[] } | null>(null);
  const [mutual, setMutual] = useState<MatchView[]>([]);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([get<{ quota: number; matches: MatchView[] }>('/matches/today'), get<MatchView[]>('/matches/mutual')]);
    setToday(a);
    setMutual(b);
  }, []);
  useEffect(() => {
    if (ready) load().catch(setError);
  }, [ready, load]);
  async function run() {
    try {
      await post('/matching/run');
      setQueued(true);
    } catch (e) {
      setError(e);
    }
  }
  if (!today) return error ? <ErrorNote error={error} /> : <Spinner />;
  const fresh = today.matches.filter((m) => m.status !== 'MUTUAL');
  return (
    <div className="space-y-6">
      <PageTitle sub={t('matches.quota', { n: today.quota })}>{t('matches.title')}</PageTitle>
      <ErrorNote error={error} />
      {fresh.length === 0 ? (
        <div className="card space-y-3 text-center">
          <p className="text-sm text-black/60">{queued ? t('matches.queued') : t('matches.empty')}</p>
          {!queued && <button className="btn-ghost mx-auto" onClick={run}>{t('matches.run')}</button>}
        </div>
      ) : (
        fresh.map((m) => <MatchCard key={m.matchId} m={m} onChange={load} />)
      )}
      {mutual.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t('matches.mutualList')}</h2>
          {mutual.map((m) => (
            <MatchCard key={m.matchId} m={m} onChange={load} />
          ))}
        </section>
      )}
    </div>
  );
}
