# Утренний запуск: новые B2B-лиды для Lerega

Эту инструкцию выполняет запланированная сессия Claude каждое утро. Владелец бизнеса читает итог на русском.

## Правила отбора (коротко)

- Не брать: крупные сети с ремонтом через головной офис (IKEA, Rooms To Go, Ashley, Living Spaces, World Market, At Home, Lovesac),
  конкурентов (категории upholstery / leather repair / furniture repair), уже известных (`data/leads.csv`, CRM).
- Бюджет Firecrawl маленький (дневной лимит кончается за ~100 кредитов): поиск по картам = 10 кредитов за запрос;
  почту искать через `firecrawl_scrape` с `formats: ["links"]` (дешевле всего, `mailto:` видно в ссылках),
  страницу Contact — только если на главной почты нет.

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
   Каналы (`facility_subcontract`, `industry_association`, `buyer_event`, у них `"rotate": False`) в ежедневный план не попадают:
   это национальные сети и ассоциации, их на картах не ищут.
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

1. Для новых лидов с сайтом найти почту, напечатанную на их сайте (главная, футер, страница Contact).
   Главная: Firecrawl `firecrawl_scrape`, `formats: ["links"]`, `onlyMainContent: false`,
   `includeTags: ["a[href^='mailto:']", "a[href*='contact' i]"]` — в ответе только `mailto:` и ссылки на Contact (1 кредит, короткий ответ).
   Если `mailto:` нет — страница Contact: `formats: ["markdown"]`, `onlyMainContent: true`,
   `excludeTags: ["img","svg","iframe","picture","noscript","gmp-map"]` (видна и почта простым текстом).
   Не угадывать адреса. Почта сети/франшизы (не этой точки) — не использовать, записать в описание.
   Две компании с одним ящиком — письмо только одной.
2. Записать найденное в `data/leads.csv` (`email`, `contact_name` — только если имя явно указано у адреса).
3. `python3 leadgen/outreach.py drafts` → `data/outreach/drafts-$DAY.json`.
4. **Ничего не отправлять.** Каждое письмо положить черновиком в Zoho Mail через Zapier:
   `zoho_mail_create_draft`, connection `023dfe63-f6a5-84f4-b080-f3cebd8b4a6b`, `accountId` `643277000000008002`,
   `fromAddress` из черновика, `mailFormat: html`, `content` = поле `html` черновика (Verdana 10pt + подпись Zoho «Main»). Статус лида — `Draft in Zoho`, id черновика — в drafts-$DAY.json.
   Отправляет владелец сам из папки «Черновики» Zoho (dillon@lerega.com).
   Если вызов создания черновика оборвался по таймауту — сначала поиск `/messages/search` с `searchKey` = `to:<домен>`:
   черновик обычно уже создан; повторять только если его нет (иначе будет дубль).

## 3b. Ответы на отправленные письма

Zoho (craft@lerega.com, connection `023dfe63-f6a5-84f4-b080-f3cebd8b4a6b`): поиск во входящих по отправителям из `data/outreach.csv`
(`/messages/search`, `searchKey` = `sender:домен::or:sender:домен`, не больше ~7 доменов за запрос — длинный ключ Zoho отклоняет).
Для каждого ответа: что просят, есть ли заказ в CRM (`orders.client_name`, `messages`), отправлена ли цена.
Если с ответа или цены прошло больше 3 дней и тишина — черновик короткого повторного письма в Zoho.
Автоответы («out of office») — просто отметить.

## 4. Google-таблица

```bash
python3 leadgen/find_leads.py sheet > sheet.csv
```

Google Drive `create_file`: title `Лиды $DAY`, `parentId` = `1SZtvrai0LVhUK8bk8zjtpmnyDUbqvw0I`
(папка «Lerega — B2B лиды»), `contentMimeType` = `text/csv`, содержимое — ссылкой на файл, а не текстом:
`base64Content` = `sha256:<sha256sum файла>:<абсолютный путь к sheet.csv>` (Google Drive сам подставит файл).
Получится Google Sheet. Если новых лидов 0 — таблицу не создавать.

## 5. Сохранить

```bash
git add data leadgen && git commit -m "Leads $DAY: N new" && git push -u origin claude/bold-thompson-sv09bw
```

## 6. Уведомление

Последнее сообщение сессии (оно приходит владельцу push-уведомлением), по-русски, коротко:

```
Лиды на <дата>: N новых (Коммерция X, Мебель Y, Сумки Z). Черновиков в Zoho: K — проверьте и отправьте из папки «Черновики».
Топ-3: <компания — город — что предложить>.
Таблица: <ссылка на Google Sheet>
```

Если что-то сломалось (ScrapeGraph недоступен, кончились кредиты) — одной строкой сказать, что и какой путь сработал.
