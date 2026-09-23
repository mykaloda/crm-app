'use client';
import Link from 'next/link';
import { useEffect } from 'react';
import { CopyField } from '@/components/copy-field';
import { OnboardingSteps } from '@/components/onboarding-steps';
import { PageTitle, useGuard } from '@/components/ui';
import { API_URL, MCP_URL } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

export default function Connect() {
  const { me } = useGuard();
  const { reload } = useMe();
  const { t } = useI18n();
  // Refresh when the user comes back from authorising their AI in another tab.
  useEffect(() => {
    const onFocus = () => void reload();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);
  const connected = (type: string) => me?.connections.some((c) => c.type === type);
  return (
    <div>
      <OnboardingSteps current="connect" />
      <PageTitle sub={t('connect.body')}>{t('connect.title')}</PageTitle>
      <div className="space-y-4">
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t('connect.mcp.title')}</h2>
            {connected('MCP') && <span className="chip bg-emerald-100 text-emerald-800">{t('connect.connected')}</span>}
          </div>
          <p className="text-sm text-black/60">{t('connect.mcp.body')}</p>
          <CopyField value={`${MCP_URL}/mcp`} />
        </section>
        <section className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">{t('connect.gpt.title')}</h2>
            {connected('CUSTOM_GPT') && <span className="chip bg-emerald-100 text-emerald-800">{t('connect.connected')}</span>}
          </div>
          <p className="text-sm text-black/60">{t('connect.gpt.body')}</p>
          <label className="label">{t('connect.gpt.spec')}</label>
          <CopyField value={`${API_URL}/agent/v1/openapi.json`} />
        </section>
        <section className="card space-y-3">
          <h2 className="font-medium">{t('connect.builtin.title')}</h2>
          <p className="text-sm text-black/60">{t('connect.builtin.body')}</p>
          <Link href="/onboarding/interview" className="btn-primary">{t('connect.builtin.start')}</Link>
        </section>
      </div>
      {me?.onboarding.aiConnected && (
        <Link href="/profile" className="btn-ghost mt-6">{t('common.continue')}</Link>
      )}
    </div>
  );
}
