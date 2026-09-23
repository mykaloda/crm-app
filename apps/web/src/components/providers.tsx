'use client';
import { useEffect } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { MeProvider } from '@/lib/use-me';
import { Nav } from './nav';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return (
    <I18nProvider>
      <MeProvider>
        <Nav />
        <main className="mx-auto max-w-3xl px-4 pb-24 pt-6">{children}</main>
      </MeProvider>
    </I18nProvider>
  );
}
