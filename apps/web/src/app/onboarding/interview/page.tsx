'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ErrorNote, PageTitle, Spinner, useGuard } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

interface Session {
  sessionId: string;
  status: string;
  messages: { role: 'assistant' | 'user'; content: string }[];
  done?: boolean;
  draftId?: string;
}

export default function Interview() {
  useGuard();
  const { t } = useI18n();
  const { reload } = useMe();
  const [s, setS] = useState<Session | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const current = await get<Session | null>('/interview');
        setS(current && current.status === 'active' ? current : await post<Session>('/interview/start'));
      } catch (e) {
        setError(e);
      }
    })();
  }, []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [s?.messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!s || !text.trim()) return;
    setBusy(true);
    const content = text;
    setText('');
    setS({ ...s, messages: [...s.messages, { role: 'user', content }] });
    try {
      const next = await post<Session>(`/interview/${s.sessionId}/message`, { content });
      setS(next);
      if (next.status === 'completed') await reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!s) return;
    setS(await post<Session>(`/interview/${s.sessionId}/finish`));
    await reload();
  }

  if (!s) return error ? <ErrorNote error={error} /> : <Spinner />;
  const done = s.status === 'completed';
  return (
    <div>
      <PageTitle>{t('interview.title')}</PageTitle>
      <div className="card space-y-3">
        {s.messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : ''}`}>
            <p className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm ${m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-black/5'}`}>{m.content}</p>
          </div>
        ))}
        {busy && <p className="text-xs text-black/40">…</p>}
        <div ref={bottom} />
      </div>
      <ErrorNote error={error} />
      {done ? (
        <div className="mt-4 flex items-center gap-3">
          <p className="text-sm">{t('interview.done')}</p>
          <Link href="/profile" className="btn-primary">{t('interview.review')}</Link>
        </div>
      ) : (
        <>
          <form onSubmit={send} className="mt-4 flex gap-2">
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('interview.placeholder')} disabled={busy} autoFocus />
            <button className="btn-primary" disabled={busy || !text.trim()}>{t('interview.send')}</button>
          </form>
          <button onClick={finish} className="mt-3 text-sm text-black/50 underline">{t('interview.finish')}</button>
        </>
      )}
    </div>
  );
}
