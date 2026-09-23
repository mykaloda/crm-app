'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNote, PageTitle, Spinner, useGuard } from '@/components/ui';
import { API_URL, del, post, put } from '@/lib/api';
import { Locale } from '@/lib/dictionaries';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

export default function Settings() {
  const { me } = useGuard();
  const { reload } = useMe();
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const run = (f: () => Promise<unknown>) => f().then(reload, setError);
  if (!me) return <Spinner />;
  const consent = (type: string, key: string, label: string) => (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" className="mt-1 accent-brand-600" checked={me.consents.includes(type)} onChange={(e) => run(() => post('/me/consents', { [key]: e.target.checked }))} />
      {label}
    </label>
  );
  return (
    <div className="space-y-5">
      <PageTitle>{t('settings.title')}</PageTitle>
      <ErrorNote error={error} />

      <section className={`card space-y-3 ${me.aiEnabled ? '' : 'ring-red-200'}`}>
        <h2 className="font-medium">{t('settings.ai')}</h2>
        <p className="text-sm text-black/60">{me.aiEnabled ? t('settings.aiOn') : t('settings.aiOff')}</p>
        <button className={me.aiEnabled ? 'btn-danger' : 'btn-primary'} onClick={() => run(() => put('/privacy/ai', { enabled: !me.aiEnabled }))}>
          {me.aiEnabled ? t('settings.aiDisable') : t('settings.aiEnable')}
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t('settings.connections')}</h2>
        {me.connections.length === 0 && <p className="text-sm text-black/50">{t('common.none')}</p>}
        {me.connections.map((c) => (
          <div key={c.id} className="flex items-center justify-between text-sm">
            <span>
              {c.label} <span className="chip">{c.type}</span>
            </span>
            <button className="btn-ghost" onClick={() => run(() => del(`/connections/${c.id}`))}>{t('settings.disconnect')}</button>
          </div>
        ))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t('settings.consents')}</h2>
        {consent('AI_PROCESSING', 'aiProcessing', t('consent.ai'))}
        {consent('SENSITIVE_DATA', 'sensitiveData', t('consent.sensitive'))}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t('settings.subscription')}</h2>
        {me.subscription ? (
          <div className="flex items-center justify-between text-sm">
            <span>{t('settings.premium')}</span>
            <button className="btn-ghost" onClick={() => run(() => post('/billing/cancel'))}>{t('settings.cancelSub')}</button>
          </div>
        ) : (
          <button className="btn-primary" onClick={() => post<{ url: string }>('/billing/checkout').then((r) => (window.location.href = r.url), setError)}>
            {t('settings.subscribe')}
          </button>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t('settings.language')}</h2>
        <select className="input max-w-40" value={locale} onChange={(e) => {
          setLocale(e.target.value as Locale);
          void put('/me/locale', { locale: e.target.value });
        }}>
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t('settings.export')}</h2>
        <p className="text-sm text-black/60">{t('settings.exportHint')}</p>
        <a className="btn-ghost" href={`${API_URL}/privacy/export`}>{t('settings.export')}</a>
      </section>

      <section className="card space-y-3 ring-red-100">
        <h2 className="font-medium text-red-700">{t('settings.delete')}</h2>
        <p className="text-sm text-black/60">{t('settings.deleteHint')}</p>
        <input className="input" placeholder={me.email} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button
          className="btn-danger"
          disabled={confirm.trim().toLowerCase() !== me.email.toLowerCase()}
          onClick={() => del('/privacy/account', { confirmEmail: confirm }).then(async () => {
            await reload();
            router.push('/');
          }, setError)}
        >
          {t('settings.deleteConfirm')}
        </button>
      </section>
    </div>
  );
}
