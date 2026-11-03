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
Лиды на <дата>: N новых (Коммерция X, Мебель Y, Сумки Z).
Топ-3: <компания — город — что предложить>.
Таблица: <ссылка на Google Sheet>
```

Если что-то сломалось (ScrapeGraph недоступен, кончились кредиты) — одной строкой сказать, что и какой путь сработал.
