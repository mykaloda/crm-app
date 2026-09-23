'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ErrorNote, PageTitle, useGuard } from '@/components/ui';
import { post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

function MockVerify() {
  useGuard({ onboarding: true });
  const { t } = useI18n();
  const { reload } = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const r = await post<{ status: string }>('/verification/age/mock/complete', { sessionId: params.get('session'), birthDate });
      await reload();
      router.push(r.status === 'VERIFIED' ? '/onboarding/connect' : '/onboarding/verify');
    } catch (err) {
      setError(err);
    }
  }
  return (
    <form onSubmit={submit} className="card max-w-sm space-y-3">
      <PageTitle>{t('verify.mockTitle')}</PageTitle>
      <label className="label">{t('verify.birthDate')}</label>
      <input className="input" type="date" required value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      <ErrorNote error={error} />
      <button className="btn-primary">{t('verify.submit')}</button>
    </form>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MockVerify />
    </Suspense>
  );
}
