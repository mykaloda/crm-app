'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Spinner, useGuard } from '@/components/ui';

/** Sends the user to their next onboarding step. */
export default function Onboarding() {
  const { me } = useGuard({ onboarding: true });
  const router = useRouter();
  useEffect(() => {
    if (!me) return;
    const next = me.onboarding.nextStep;
    router.replace(next === 'done' ? '/matches' : next === 'profile' ? '/profile' : `/onboarding/${next}`);
  }, [me, router]);
  return <Spinner />;
}
