'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { API_URL, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';
import { ErrorNote } from './ui';

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const { t, locale } = useI18n();
  const { reload } = useMe();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post(mode === 'login' ? '/auth/login' : '/auth/register', { email, password, locale });
      await reload();
      const next = new URLSearchParams(window.location.search).get('next');
      router.push(next?.startsWith('/') && !next.startsWith('//') ? next : mode === 'login' ? '/matches' : '/onboarding');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="mb-6 text-2xl font-semibold">{mode === 'login' ? t('auth.login') : t('auth.signup')}</h1>
      <div className="space-y-2">
        <a href={`${API_URL}/auth/google/start`} className="btn-ghost w-full">{t('auth.google')}</a>
        <a href={`${API_URL}/auth/apple/start`} className="btn-ghost w-full"> {t('auth.apple')}</a>
      </div>
      <p className="my-4 text-center text-xs uppercase text-black/40">{t('auth.or')}</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className="label" htmlFor="email">{t('auth.email')}</label>
          <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">{t('auth.password')}</label>
          <input id="password" className="input" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'signup' && <p className="mt-1 text-xs text-black/40">{t('auth.passwordHint')}</p>}
        </div>
        <ErrorNote error={error} />
        <button className="btn-primary w-full" disabled={busy}>{mode === 'login' ? t('auth.login') : t('auth.signup')}</button>
      </form>
      <p className="mt-6 text-center text-sm text-black/60">
        {mode === 'login' ? t('auth.noAccount') : t('auth.haveAccount')}{' '}
        <Link className="text-brand-600" href={mode === 'login' ? '/signup' : '/login'}>{mode === 'login' ? t('auth.signup') : t('auth.login')}</Link>
      </p>
    </div>
  );
}
