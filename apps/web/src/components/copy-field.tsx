'use client';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';

export function CopyField({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly className="input font-mono text-xs" value={value} onFocus={(e) => e.target.select()} />
      <button
        className="btn-ghost shrink-0"
        onClick={async () => {
          await navigator.clipboard.writeText(value).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}
