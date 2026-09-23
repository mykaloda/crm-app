'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, Me, get } from './api';

interface MeState {
  me: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const Ctx = createContext<MeState>({ me: null, loading: true, reload: async () => undefined });

export function MeProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      setMe(await get<Me>('/me'));
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <Ctx.Provider value={{ me, loading, reload }}>{children}</Ctx.Provider>;
}

export const useMe = () => useContext(Ctx);
