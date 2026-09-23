'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ErrorNote, useGuard } from '@/components/ui';
import { post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

function MockCheckout() {
  useGuard();
  const { t } = useI18n();
  const { reload } = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="card mx-auto max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">{t('billing.mockTitle')}</h1>
      <p className="text-sm text-black/60">Premium · 30 days</p>
      <ErrorNote error={error} />
      <button
        className="btn-primary w-full"
        onClick={() => post('/billing/mock/complete', { sessionId: params.get('session') }).then(async () => {
          await reload();
          router.push('/settings');
        }, setError)}
      >
        {t('billing.pay')}
      </button>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MockCheckout />
    </Suspense>
  );
}
