# crm-sync

Выгрузка данных Lerega CRM через ключ «AI access to CRM data (read-only)» в SQLite и CSV.
Нужен только Python 3.11+, внешних зависимостей нет.

## Что нужно один раз

claude.ai/code → значок облака с именем окружения над полем ввода → **Cloud** → шестерёнка
у окружения → **Edit environment**. Дальше один из двух вариантов:

- **API credentials** (планы Pro и Max): **Add credential**, Allowed websites `crm.lerega.com`,
  заголовок `Authorization`, префикс `Bearer`, значение — ключ из Settings → Channels → AI access.
  Домен открывается сам, ключ не виден ни сессиям, ни скрипту.
- Или **Network access** → **Custom** → `crm.lerega.com` в **Allowed domains** (с галкой
  про стандартный список) и строка `LEREGA_CRM_KEY=<ключ>` в **Environment variables**.

## Команды

```sh
python3 crm-sync/sync.py discover          # что умеет сервер -> data/schema.json
python3 crm-sync/sync.py plan              # черновик plan.json по списку инструментов
python3 crm-sync/sync.py call TOOL '{}'    # вызвать один инструмент и посмотреть ответ
python3 crm-sync/sync.py pull              # выгрузка по расписанию: таблицы для сводки + агрегаты -> data/crm.sqlite, data/export/*.csv
python3 crm-sync/sync.py pull --full       # полная выгрузка: ещё сырая переписка, визиты сайта и заметки
python3 crm-sync/sync.py pull orders       # только указанные сущности
python3 crm-sync/analytics.py              # документы сводки -> data/dashboard/summary.json, pipeline.json
python3 crm-sync/export_xlsx.py            # все таблицы одним файлом -> data/export/lerega-crm.xlsx (нужен openpyxl)
python3 crm-sync/tests/test_sync.py      # тесты на имитации сервера
```

## Как хранятся данные

`crm-sync/data/` (в `.gitignore`):

- `crm.sqlite` — таблица `_records` (каждая запись как JSON), `_history` (что появилось,
  изменилось или пропало при каждой выгрузке), `_runs` (журнал выгрузок). Для каждой
  сущности есть одноимённое представление с плоскими колонками: `SELECT * FROM orders`.
- `export/<сущность>.csv` — те же таблицы для Excel (UTF-8 с BOM).
- `raw/<сущность>.json` — последний ответ сервера как есть.

## plan.json

Описывает, какой инструмент MCP-сервера даёт какую сущность и как листать страницы:

```json
{
  "sql_tool": {"name": "query", "arg": "sql"},
  "entities": [
    {"name": "orders", "tool": "list_orders", "key": "id",
     "paginate": {"cursor_arg": "cursor", "limit_arg": "limit", "limit": 100}},
    {"name": "clients", "tool": "list_clients", "paginate": {"page_arg": "page"}},
    {"name": "order_details", "tool": "get_order",
     "for_each": {"from": "orders", "field": "id", "arg": "id", "changed_only": true}},
    {"name": "payments", "sql": "SELECT * FROM payments", "key": "id"}
  ]
}
```

- `paginate`: `cursor_arg` + `next` (путь к следующему курсору в ответе), или `page_arg`,
  или `offset_arg`; `limit_arg`/`limit` — размер страницы. Листаем до пустой страницы.
- `items`: путь к списку в ответе, если его не удаётся найти автоматически; `"."` — весь
  ответ это одна запись.
- `for_each`: вызвать инструмент для каждой записи другой сущности; `changed_only` —
  только для новых и изменившихся.
- `ignore`: поля, изменение которых не считается изменением записи.
- `complete: false`: инструмент отдаёт не все записи, поэтому отсутствующие не помечаются удалёнными.

## Сводка

`dashboard.html` — страница-артефакт «Сводка Lerega Upholstery»
(https://claude.ai/artifact/WUziqN8zdPuAchtY9nMSxH). Сама страница данных не содержит: она читает
документы `dashboard/summary` и `dashboard/pipeline` из своего хранилища. После `analytics.py`
их записывают туда инструментом ArtifactData (set с `file_path`). На страницу попадают только
агрегаты и номера заказов, без имён, адресов, сообщений и заметок.

Блок «Метрики плана» повторяет таблицу «Метрики на каждую неделю» из документа «Lerega: диагностика
и план роста»: факт, база и цель, изменение к той же мере неделю назад. Недельные метрики берут
последнюю полную неделю (пн–вс), конверсия — обращения 45–74 дней назад. Строки, которые меряются вне
CRM (Square, реклама, Google), берутся из `data/scorecard_manual.json`:

```json
{"as_of": "2026-10-12", "values": {"net_sales": {"value": 31200, "note": "Square + оплаты мимо него"}},
 "previous": {"as_of": "2026-10-05", "values": {"net_sales": {"value": 30400}}}}
```

Переписка и визиты сайта для сводки считаются на сервере CRM (сущности `agg_*` в `plan.json`),
поэтому регулярной выгрузке хватает ~35 запросов. Сырые таблицы (`full_only`) выгружаются только с `--full`.
