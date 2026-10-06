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
python3 crm-sync/sync.py pull              # выгрузить всё из plan.json -> data/crm.sqlite + data/export/*.csv
python3 crm-sync/sync.py pull orders       # только указанные сущности
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
