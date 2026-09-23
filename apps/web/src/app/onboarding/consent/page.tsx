'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { OnboardingSteps } from '@/components/onboarding-steps';
import { ErrorNote, PageTitle, useGuard } from '@/components/ui';
import { post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

export default function Consent() {
  useGuard({ onboarding: true });
  const { t } = useI18n();
  const { reload } = useMe();
  const router = useRouter();
  const [v, setV] = useState({ terms: false, privacy: false, aiProcessing: false, sensitiveData: false });
  const [error, setError] = useState<unknown>(null);
  const box = (key: keyof typeof v, label: string, note?: string) => (
    <label className="flex gap-3 rounded-xl p-3 hover:bg-black/[0.02]">
      <input type="checkbox" className="mt-1 size-4 accent-brand-600" checked={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.checked })} />
      <span className="text-sm">
        {label}
        {note && <span className="mt-1 block text-xs text-black/50">{note}</span>}
      </span>
    </label>
  );
  async function submit() {
    try {
      await post('/me/consents', v);
      await reload();
      router.push('/onboarding/verify');
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div>
      <OnboardingSteps current="consent" />
      <PageTitle>{t('consent.title')}</PageTitle>
      <div className="card space-y-1">
        {box('terms', t('consent.terms'))}
        {box('privacy', t('consent.privacy'))}
        {box('aiProcessing', t('consent.ai'))}
        <div className="my-2 border-t border-black/5" />
        {box('sensitiveData', t('consent.sensitive'), t('consent.sensitiveNote'))}
      </div>
      <ErrorNote error={error} />
      <button className="btn-primary mt-4" disabled={!v.terms || !v.privacy || !v.aiProcessing} onClick={submit}>{t('common.continue')}</button>
    </div>
  );
}
