'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { OnboardingSteps } from '@/components/onboarding-steps';
import { ErrorNote, PageTitle, useGuard } from '@/components/ui';
import { post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function Verify() {
  const { me } = useGuard({ onboarding: true });
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (me?.ageVerificationStatus === 'VERIFIED') router.replace('/onboarding/connect');
  }, [me, router]);
  async function start() {
    try {
      const r = await post<{ status: string; redirectUrl?: string }>('/verification/age/start');
      if (r.redirectUrl) window.location.href = r.redirectUrl;
      else router.push('/onboarding/connect');
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div>
      <OnboardingSteps current="verify" />
      <PageTitle sub={t('verify.body')}>{t('verify.title')}</PageTitle>
      {me?.ageVerificationStatus === 'REJECTED' && <p className="mb-4 text-sm text-red-700">{t('verify.rejected')}</p>}
      <ErrorNote error={error} />
      <button className="btn-primary" onClick={start}>{t('verify.start')}</button>
    </div>
  );
}
