'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useMe } from '@/lib/use-me';

export function Nav() {
  const { me, reload } = useMe();
  const { t } = useI18n();
  const path = usePathname();
  const router = useRouter();
  const links = [
    ['/matches', t('nav.matches')],
    ['/chats', t('nav.chats')],
    ['/profile', t('nav.profile')],
    ['/agent', t('nav.agent')],
    ['/settings', t('nav.settings')],
    ...(me && me.role !== 'USER' ? [['/admin', t('nav.admin')]] : []),
  ];
  async function logout() {
    await post('/auth/logout').catch(() => undefined);
    await reload();
    router.push('/');
  }
  return (
    <header className="sticky top-0 z-10 border-b border-black/5 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
        <Link href={me ? '/matches' : '/'} className="font-semibold text-brand-600">
          ♥ {t('app.name')}
        </Link>
        {me && (
          <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={`rounded-lg px-2.5 py-1.5 whitespace-nowrap ${path.startsWith(href) ? 'bg-brand-50 text-brand-700' : 'text-black/60 hover:text-black'}`}>
                {label}
                {href === '/profile' && me.pendingDrafts > 0 && <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-xs text-white">{me.pendingDrafts}</span>}
              </Link>
            ))}
          </nav>
        )}
        {me && (
          <button onClick={logout} className="text-sm text-black/50 hover:text-black">
            {t('nav.logout')}
          </button>
        )}
      </div>
    </header>
  );
}
