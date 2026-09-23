'use client';
import { useI18n } from '@/lib/i18n';

const STEPS = ['consent', 'verify', 'connect', 'profile'] as const;

export function OnboardingSteps({ current }: { current: (typeof STEPS)[number] }) {
  const { t } = useI18n();
  const idx = STEPS.indexOf(current);
  return (
    <ol className="mb-6 flex gap-2 text-xs">
      {STEPS.map((s, i) => (
        <li key={s} className={`flex-1 rounded-full px-3 py-1.5 text-center ${i < idx ? 'bg-emerald-100 text-emerald-800' : i === idx ? 'bg-brand-600 text-white' : 'bg-black/5 text-black/50'}`}>
          {t(`onb.step.${s}`)}
        </li>
      ))}
    </ol>
  );
}
