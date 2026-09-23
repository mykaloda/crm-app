'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ErrorNote, PageTitle, Spinner, useGuard } from '@/components/ui';
import { get } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ChatItem {
  matchId: string;
  title: string;
  unread: number;
  lastMessage: { body: string; createdAt: string } | null;
}

export default function Chats() {
  const { ready } = useGuard();
  const { t } = useI18n();
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (ready) get<ChatItem[]>('/chats').then(setItems, setError);
  }, [ready]);
  if (!items) return error ? <ErrorNote error={error} /> : <Spinner />;
  return (
    <div>
      <PageTitle>{t('chat.title')}</PageTitle>
      {items.length === 0 && <p className="text-sm text-black/50">{t('common.none')}</p>}
      <ul className="space-y-2">
        {items.map((c) => (
          <li key={c.matchId}>
            <Link href={`/chats/${c.matchId}`} className="card flex items-center justify-between hover:ring-brand-100">
              <div>
                <p className="font-medium">{c.title}</p>
                <p className="line-clamp-1 text-sm text-black/50">{c.lastMessage?.body ?? t('chat.empty')}</p>
              </div>
              {c.unread > 0 && <span className="rounded-full bg-brand-600 px-2 text-xs text-white">{c.unread}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
