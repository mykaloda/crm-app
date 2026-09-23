'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DICTIONARIES, DictKey, Locale } from './dictionaries';

export function translate(locale: Locale, key: DictKey, vars?: Record<string, string | number>): string {
  let s: string = DICTIONARIES[locale][key] ?? DICTIONARIES.en[key] ?? key;
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const FIELD_LABELS: Record<Locale, Record<string, string>> = {
  en: {},
  ru: {
    displayName: 'Имя', birthDate: 'Дата рождения', gender: 'Пол', seeking: 'Кого ищу', ageMin: 'Возраст от', ageMax: 'Возраст до',
    city: 'Город', lat: 'Широта', lng: 'Долгота', radiusKm: 'Радиус, км', relationshipType: 'Тип отношений', hasChildren: 'Есть дети',
    wantsChildren: 'Хочу детей', timeline: 'Сроки', smoking: 'Курение', alcohol: 'Алкоголь', exercise: 'Спорт', schedule: 'Режим дня',
    pets: 'Питомцы', relocation: 'Готовность к переезду', family: 'Семья (1–5)', career: 'Карьера (1–5)', money: 'Деньги (1–5)',
    faith: 'Вера', faithImportance: 'Важность веры (1–5)', politics: 'Политика', politicsImportance: 'Важность политики (1–5)',
    openness: 'Открытость', conscientiousness: 'Добросовестность', extraversion: 'Экстраверсия', agreeableness: 'Доброжелательность',
    neuroticism: 'Нейротизм', communicationStyle: 'Стиль общения', temperament: 'Темперамент', interestTags: 'Интересы (теги)',
    interestsText: 'Об интересах', excludeSmoking: 'Неприемлемое курение', excludeAlcohol: 'Неприемлемый алкоголь',
    excludePets: 'Неприемлемые питомцы', noPartnerChildren: 'Без детей у партнёра', aiDescription: 'Описание',
  },
};

export function humanize(s: string): string {
  const spaced = s.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
  field: (key: string) => string;
}

const Ctx = createContext<I18n>({
  locale: 'en',
  setLocale: () => undefined,
  t: (k, v) => translate('en', k, v),
  field: humanize,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  useEffect(() => {
    try {
      const saved = localStorage.getItem('locale') as Locale | null;
      if (saved && saved in DICTIONARIES) setLocaleState(saved);
      else if (navigator.language.startsWith('ru')) setLocaleState('ru');
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem('locale', l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(locale, key, vars), [locale]);
  const field = useCallback((key: string) => FIELD_LABELS[locale][key] ?? humanize(key), [locale]);
  return <Ctx.Provider value={{ locale, setLocale, t, field }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
