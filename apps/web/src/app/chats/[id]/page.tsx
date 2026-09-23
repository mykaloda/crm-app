'use client';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { ErrorNote, Spinner, useGuard } from '@/components/ui';
import { API_URL, get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Msg {
  id: string;
  matchId: string;
  senderId: string;
  body: string;
  createdAt: string;
  mine?: boolean;
}

export default function ChatPage() {
  const { ready, me } = useGuard();
  const { t } = useI18n();
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Msg[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<unknown>(null);
  const socket = useRef<Socket | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    get<Msg[]>(`/chats/${id}/messages`).then(setMessages, setError);
    void post(`/chats/${id}/read`).catch(() => undefined);
    // The access cookie is sent with the websocket handshake (same site).
    const s = io(`${API_URL}/chat`, { withCredentials: true, transports: ['websocket'] });
    s.on('message:new', (m: Msg) => {
      if (m.matchId !== id) return;
      setMessages((prev) => (prev && !prev.some((x) => x.id === m.id) ? [...prev, m] : prev));
      void post(`/chats/${id}/read`).catch(() => undefined);
    });
    socket.current = s;
    return () => {
      s.close();
    };
  }, [ready, id]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [messages?.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText('');
    const s = socket.current;
    if (s?.connected) {
      const ack = await s.timeout(5000).emitWithAck('message:send', { matchId: id, body }).catch(() => null);
      if (ack?.ok) return;
    }
    // Fallback to REST when the socket is unavailable.
    try {
      await post(`/chats/${id}/messages`, { body });
      setMessages(await get<Msg[]>(`/chats/${id}/messages`));
    } catch (err) {
      setError(err);
    }
  }

  if (!messages) return error ? <ErrorNote error={error} /> : <Spinner />;
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">{t('chat.safety')}</p>
      <div className="card flex-1 space-y-2 overflow-y-auto">
        {messages.length === 0 && <p className="text-center text-sm text-black/40">{t('chat.empty')}</p>}
        {messages.map((m) => {
          const mine = m.mine ?? m.senderId === me?.id;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : ''}`}>
              <p className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand-600 text-white' : 'bg-black/5'}`}>{m.body}</p>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <ErrorNote error={error} />
      <form onSubmit={send} className="mt-3 flex gap-2">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} maxLength={2000} />
        <button className="btn-primary">{t('chat.send')}</button>
      </form>
    </div>
  );
}
