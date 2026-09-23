'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorNote, PageTitle, useGuard } from '@/components/ui';
import { post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const REASONS = ['fake_profile', 'harassment', 'scam_or_money', 'inappropriate_content', 'underage', 'safety_concern', 'other'];

export default function Feedback() {
  useGuard();
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [met, setMet] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [details, setDetails] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const run = (f: () => Promise<unknown>, ok: string) => f().then(() => setMsg(ok), setError);
  return (
    <div className="space-y-6">
      <PageTitle>{t('feedback.title')}</PageTitle>
      {msg && <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{msg}</p>}
      <ErrorNote error={error} />
      <div className="card space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="accent-brand-600" checked={met} onChange={(e) => setMet(e.target.checked)} /> {t('feedback.met')}
        </label>
        <div>
          <p className="label">{t('feedback.rating')}</p>
          <div className="flex gap-1 text-2xl">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} className={n <= rating ? 'text-amber-500' : 'text-black/20'}>★</button>
            ))}
          </div>
        </div>
        <textarea className="input" placeholder={t('feedback.comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="btn-primary" onClick={() => run(() => post(`/matches/${id}/feedback`, { met, rating: rating || undefined, comment: comment || undefined }), t('feedback.thanks'))}>
          {t('common.save')}
        </button>
      </div>
      <div className="card space-y-3">
        <p className="label">{t('report.reason')}</p>
        <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
          {REASONS.map((r) => (
            <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <textarea className="input" placeholder={t('report.details')} value={details} onChange={(e) => setDetails(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => run(() => post('/reports', { matchId: id, reason, details: details || undefined }), t('report.sent'))}>{t('report.send')}</button>
          <button className="btn-ghost" onClick={() => run(() => post(`/matches/${id}/unmatch`), t('profile.saved'))}>{t('matches.unmatch')}</button>
          <button className="btn-danger" onClick={() => run(() => post('/blocks', { matchId: id }), t('profile.saved'))}>{t('matches.block')}</button>
        </div>
      </div>
    </div>
  );
}
