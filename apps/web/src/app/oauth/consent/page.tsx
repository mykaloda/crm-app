'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { ErrorNote, Spinner, useGuard } from '@/components/ui';
import { get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function Consent() {
  const { ready } = useGuard();
  const { t } = useI18n();
  const params = useSearchParams();
  const id = params.get('request');
  const [info, setInfo] = useState<{ clientName: string; redirectHost: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (ready && id) get<{ clientName: string; redirectHost: string }>(`/oauth/requests/${id}`).then(setInfo, setError);
  }, [ready, id]);
  async function decide(approve: boolean) {
    try {
      const r = await post<{ redirectUrl: string }>(`/oauth/requests/${id}/decision`, { approve });
      window.location.href = r.redirectUrl;
    } catch (e) {
      setError(e);
    }
  }
  if (error) return <ErrorNote error={error} />;
  if (!info) return <Spinner />;
  return (
    <div className="card mx-auto max-w-md space-y-4 py-8">
      <h1 className="text-xl font-semibold">{t('oauth.title')}</h1>
      <p className="text-sm">{t('oauth.body', { client: info.clientName })}</p>
      <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{t('oauth.never')}</p>
      <p className="text-xs text-black/40">→ {info.redirectHost}</p>
      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={() => decide(true)}>{t('oauth.allow')}</button>
        <button className="btn-ghost flex-1" onClick={() => decide(false)}>{t('oauth.deny')}</button>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Consent />
    </Suspense>
  );
}
