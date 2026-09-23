'use client';
import { useEffect, useState } from 'react';
import { ErrorNote, PageTitle, Score, Spinner, useGuard } from '@/components/ui';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface LogRow {
  id: string;
  tool: string;
  status: string;
  reason: string | null;
  agent: string;
  input: unknown;
  resultSummary: string | null;
  createdAt: string;
}
interface Negotiation {
  candidateId: string;
  candidateLabel: string;
  score: number;
  status: string;
  outcome: string | null;
  yourAgentVerdict: string | null;
  yourAgentRationale: string | null;
  theirAgentVerdict?: string | null;
  messages: { from: 'your_agent' | 'their_agent'; kind: string; content: string; at: string }[];
}

const STATUS_COLOR: Record<string, string> = { ok: 'bg-emerald-100 text-emerald-800', blocked: 'bg-red-100 text-red-800', error: 'bg-amber-100 text-amber-800', rate_limited: 'bg-amber-100 text-amber-800' };

export default function AgentPage() {
  const { ready } = useGuard();
  const { t } = useI18n();
  const [tab, setTab] = useState<'negotiations' | 'log'>('negotiations');
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [negs, setNegs] = useState<Negotiation[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!ready) return;
    get<LogRow[]>('/agent/log?limit=200').then(setLog, setError);
    get<Negotiation[]>('/negotiations').then(setNegs, setError);
  }, [ready]);
  if (!log || !negs) return error ? <ErrorNote error={error} /> : <Spinner />;
  return (
    <div>
      <PageTitle>{t('agent.title')}</PageTitle>
      <div className="mb-4 flex gap-2">
        {(['negotiations', 'log'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={tab === k ? 'btn-primary' : 'btn-ghost'}>
            {k === 'log' ? t('agent.log') : t('agent.negotiations')}
          </button>
        ))}
      </div>
      {tab === 'log' ? (
        <ul className="space-y-2">
          {log.length === 0 && <p className="text-sm text-black/50">{t('common.none')}</p>}
          {log.map((l) => (
            <li key={l.id} className="card py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <code className="font-medium">{l.tool}</code>
                <span className={`chip ${STATUS_COLOR[l.status] ?? ''}`}>{t(`agent.status.${l.status}` as never)}</span>
                <span className="text-black/40">{l.agent}</span>
                <span className="ml-auto text-xs text-black/40">{new Date(l.createdAt).toLocaleString()}</span>
              </div>
              {l.reason && <p className="mt-1 text-xs text-red-700">{l.reason}</p>}
              <details className="mt-1 text-xs text-black/60">
                <summary className="cursor-pointer">input / result</summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(l.input, null, 2)}</pre>
                {l.resultSummary && <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-black/40">{l.resultSummary}</pre>}
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-3">
          {negs.length === 0 && <p className="text-sm text-black/50">{t('common.none')}</p>}
          {negs.map((n) => (
            <li key={n.candidateId} className="card space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="font-medium">{n.candidateLabel}</p>
                <Score value={n.score} />
                <span className={`chip ${n.outcome === 'match' ? 'bg-emerald-100 text-emerald-800' : n.outcome ? 'bg-black/5' : 'bg-amber-100 text-amber-800'}`}>{n.outcome ?? n.status}</span>
              </div>
              <div className="space-y-1.5">
                {n.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === 'your_agent' ? 'justify-end' : ''}`}>
                    <p className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm ${m.from === 'your_agent' ? 'bg-brand-50' : 'bg-black/5'}`}>
                      <span className="block text-[10px] uppercase text-black/40">{m.from === 'your_agent' ? t('agent.yourAgent') : t('agent.theirAgent')} · {m.kind}</span>
                      {m.content}
                    </p>
                  </div>
                ))}
              </div>
              {n.yourAgentVerdict && (
                <p className="text-sm">
                  <span className="text-black/50">{t('agent.verdict')}: </span>
                  <b>{n.yourAgentVerdict}</b> — {n.yourAgentRationale}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
