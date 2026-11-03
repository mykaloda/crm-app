# Утренний запуск: новые B2B-лиды для Lerega

Эту инструкцию выполняет запланированная сессия Claude каждое утро. Владелец бизнеса читает итог на русском.

## 0. Подготовка

```bash
cd <repo> && git fetch origin claude/bold-thompson-sv09bw && git checkout claude/bold-thompson-sv09bw && git pull origin claude/bold-thompson-sv09bw
DAY=$(TZ=America/Chicago date +%F)
```

## 1. Поиск через ScrapeGraph (основной путь)

```bash
python3 leadgen/find_leads.py search
```

Работает, если в окружении есть `SGAI_API_KEY` и сеть пропускает `api.scrapegraphai.com`.
Скрипт сам ищет 4 сегмента дня (Коммерция ×2, Мебель, Сумки), убирает дубли и уже известных клиентов,
дописывает `data/leads.csv` и создаёт `data/daily/$DAY.csv`.

## 2. Запасной путь (если ScrapeGraph недоступен: нет ключа, сеть, кредиты)

1. `python3 leadgen/find_leads.py plan` — план дня, у каждого пункта есть `segment` и `maps_query`.
2. Для каждого пункта: Firecrawl `firecrawl_scrape` с `alexandria`
   `{"provider":"firecrawl-maps","capability":"businesses/search","options":{"query":"<maps_query>"}}`
   (можно все пункты одним вызовом, массивом).
3. Сохранить в файл в scratchpad: `[{"segment":"<segment>","results":[...места из ответа...]}, ...]`.
4. ```bash
   python3 leadgen/from_maps.py maps.json > leads.json
   python3 leadgen/find_leads.py add leads.json --source "Google Maps"
   ```

Не выдумывать компании и контакты: в таблицу идёт только то, что вернул поиск.

## 3. Сверка с CRM

Для новых компаний проверить, что их нет среди клиентов (CRM Lerega, `run_sql`):
`select client_name from orders where client_name ilike any (array['%name1%','%name2%'])`.
Если компания уже клиент — удалить её строку из `data/daily/$DAY.csv` и `data/leads.csv`
и добавить имя в `KNOWN_NAMES` в `leadgen/config.py`.

## 3a. Почта и черновики писем (без отправки)

1. Для новых лидов с сайтом найти почту, напечатанную на их сайте (главная, футер, страница Contact;
   Firecrawl `firecrawl_scrape`, `formats: ["links","markdown"]`, `onlyMainContent: false`, ищите `mailto:`).
   Не угадывать адреса. Почта сети/франшизы (не этой точки) — не использовать, записать в описание.
   Две компании с одним ящиком — письмо только одной.
2. Записать найденное в `data/leads.csv` (`email`, `contact_name` — только если имя явно указано у адреса).
3. `python3 leadgen/outreach.py drafts` → `data/outreach/drafts-$DAY.json`.
4. **Ничего не отправлять.** Отправка — только после явного «да» владельца в этой сессии:
   Zoho Mail через Zapier (`zoho_mail_send_email`, connection `023dfe63-f6a5-84f4-b080-f3cebd8b4a6b`,
   `fromAddress` из черновика, `mailFormat: plaintext`), по одному письму, затем
   `python3 leadgen/outreach.py log sent.json` и статус лида «Письмо отправлено».

## 4. Google-таблица

```bash
python3 leadgen/find_leads.py sheet > sheet.csv
```

Google Drive `create_file`: title `Лиды $DAY`, `parentId` = `1SZtvrai0LVhUK8bk8zjtpmnyDUbqvw0I`
(папка «Lerega — B2B лиды»), `contentMimeType` = `text/csv`, `textContent` = содержимое sheet.csv.
Получится Google Sheet. Если новых лидов 0 — таблицу не создавать.

## 5. Сохранить

```bash
git add data leadgen && git commit -m "Leads $DAY: N new" && git push -u origin claude/bold-thompson-sv09bw
```

## 6. Уведомление

Последнее сообщение сессии (оно приходит владельцу push-уведомлением), по-русски, коротко:

```
Лиды на <дата>: N новых (Коммерция X, Мебель Y, Сумки Z). Писем готово к отправке: K — ответьте «отправляй», чтобы отправить.
Топ-3: <компания — город — что предложить>.
Таблица: <ссылка на Google Sheet>
```

Если что-то сломалось (ScrapeGraph недоступен, кончились кредиты) — одной строкой сказать, что и какой путь сработал.
