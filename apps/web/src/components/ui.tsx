'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

export function Spinner() {
  const { t } = useI18n();
  return <p className="py-10 text-center text-sm text-black/40">{t('common.loading')}</p>;
}

export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useI18n();
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : t('common.error');
  return <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{msg}</p>;
}

export function PageTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-black/60">{sub}</p>}
    </div>
  );
}

/**
 * Client-side guard: sends anonymous users to /login and users who have not
 * finished onboarding to the next onboarding step.
 */
export function useGuard(opts: { onboarding?: boolean; staff?: boolean } = {}) {
  const { me, loading } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    if (!me) router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    else if (opts.staff && me.role === 'USER') router.replace('/matches');
    else if (!opts.onboarding && (!me.onboarding.consent || !me.onboarding.verified)) router.replace('/onboarding');
  }, [me, loading, router, opts.onboarding, opts.staff]);
  return { me, ready: !loading && !!me };
}

export function Score({ value }: { value: number }) {
  const color = value >= 75 ? 'bg-emerald-500' : value >= 60 ? 'bg-amber-500' : 'bg-black/30';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-black/10">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-black/60">{Math.round(value)}</span>
    </div>
  );
}
