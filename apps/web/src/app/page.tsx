'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

export default function Landing() {
  const { t } = useI18n();
  const { me } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me) router.replace(me.onboarding.nextStep === 'done' ? '/matches' : '/onboarding');
  }, [me, router]);
  return (
    <div className="py-10">
      <h1 className="text-4xl font-semibold leading-tight tracking-tight">{t('landing.hero')}</h1>
      <p className="mt-4 text-lg text-black/60">{t('landing.sub')}</p>
      <div className="mt-8 flex gap-3">
        <Link href="/signup" className="btn-primary px-6 py-3 text-base">{t('landing.cta')}</Link>
        <Link href="/login" className="btn-ghost px-6 py-3 text-base">{t('landing.login')}</Link>
      </div>
      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {(['f1', 'f2', 'f3'] as const).map((f) => (
          <div key={f} className="card">
            <h3 className="font-medium">{t(`landing.${f}.title`)}</h3>
            <p className="mt-2 text-sm text-black/60">{t(`landing.${f}.body`)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
