#!/usr/bin/env python3
"""Download Lerega CRM data through its read-only MCP endpoint into SQLite.

    python3 crm-sync/sync.py discover        what the server offers -> data/schema.json
    python3 crm-sync/sync.py plan            draft plan.json from the discovered tools
    python3 crm-sync/sync.py call TOOL '{}'  run one tool, print its result
    python3 crm-sync/sync.py pull            pull plan.json's entities -> data/crm.sqlite
    python3 crm-sync/sync.py pull --full     also the big raw tables marked full_only
    python3 crm-sync/sync.py export          one CSV per entity -> data/export/

Environment: LEREGA_CRM_KEY (unless an API credential on the environment adds it),
LEREGA_CRM_URL, CRM_DATA_DIR, CRM_PLAN.
Exit codes: 0 ok, 1 some entities failed (others saved), 2 nothing could be pulled.
"""

import json
import os
import re
import sys
import time
from pathlib import Path

from mcp_client import AuthError, McpClient, McpError, NetworkBlocked
from store import Store, record_key

HERE = Path(__file__).resolve().parent
DEFAULT_URL = "https://crm.lerega.com/api/mcp"

LIST_KEYS = ("items", "data", "results", "rows", "records", "list", "nodes")
CURSOR_KEYS = ("nextCursor", "next_cursor", "cursor", "next", "nextPageToken", "next_page_token")
PAGING_ARGS = {
    "cursor_arg": ("cursor", "after", "next_cursor", "page_token", "pageToken"),
    "page_arg": ("page", "page_number"),
    "offset_arg": ("offset", "skip"),
    "limit_arg": ("limit", "per_page", "page_size", "pageSize", "count", "first"),
}


class ShapeError(Exception):
    """A tool result we can't turn into records; the raw result is saved for a look."""


def log(*parts):
    print(*parts, file=sys.stderr, flush=True)


def data_dir():
    return Path(os.environ.get("CRM_DATA_DIR") or HERE / "data")


def plan_path():
    return Path(os.environ.get("CRM_PLAN") or HERE / "plan.json")


def connect():
    # Unset when the environment's API credential for crm.lerega.com adds the key instead.
    key = os.environ.get("LEREGA_CRM_KEY")
    client = McpClient(os.environ.get("LEREGA_CRM_URL") or DEFAULT_URL, key)
    client.initialize()
    return client


def get_path(value, path):
    for part in path.split(".") if path else ():
        if isinstance(value, dict):
            value = value.get(part)
        elif isinstance(value, list) and part.isdigit() and int(part) < len(value):
            value = value[int(part)]
        else:
            return None
    return value


def extract_items(result, path, entity, key_field="id"):
    """The list of records inside a tool result ("items": "." means the result is one record)."""
    if path == ".":
        return result if isinstance(result, list) else [result]
    if path:
        found = get_path(result, path)
        if not isinstance(found, list):
            raise ShapeError(f"no list at '{path}'")
        return found
    if isinstance(result, list):
        return result
    if not isinstance(result, dict):
        raise ShapeError(f"result is {type(result).__name__}, not JSON records")
    if isinstance(result.get("columns"), list) and isinstance(result.get("rows"), list):
        columns = [c.get("name") if isinstance(c, dict) else c for c in result["columns"]]
        if all(isinstance(r, list) for r in result["rows"]):
            return [dict(zip(columns, row)) for row in result["rows"]]
    keys = key_field if isinstance(key_field, list) else [key_field]
    if all(k in result for k in keys):
        return [result]  # one record (get_order(id)), even if it holds a list such as its history
    lists = {k: v for k, v in result.items() if isinstance(v, list) and (not v or isinstance(v[0], dict))}
    for k in (entity, *LIST_KEYS):
        if k in lists:
            return lists[k]
    if len(lists) == 1:
        return next(iter(lists.values()))
    if lists:
        raise ShapeError(f"several lists in result ({', '.join(lists)}); set \"items\" in plan.json")
    return [result]


def next_cursor(result, path):
    if path:
        return get_path(result, path)
    if not isinstance(result, dict):
        return None
    for holder in (result, result.get("pagination"), result.get("meta"), result.get("page_info")):
        if isinstance(holder, dict):
            for k in CURSOR_KEYS:
                if isinstance(holder.get(k), (str, int)) and holder.get(k) != "":
                    return holder[k]
    return None


def no_more(result):
    if isinstance(result, dict):
        for holder in (result, result.get("pagination"), result.get("meta")):
            if isinstance(holder, dict):
                for k in ("has_more", "hasMore", "has_next_page", "hasNextPage"):
                    if holder.get(k) is False:
                        return True
    return False


# --- fetching -------------------------------------------------------------

def fetch_tool(client, spec):
    """All records of a list tool, following cursor / page / offset pagination."""
    args = dict(spec.get("args") or {})
    paging = spec.get("paginate") or {}
    if paging.get("limit_arg"):
        args[paging["limit_arg"]] = paging.get("limit", 100)
    records, keys, cursor = [], set(), None
    page = paging.get("start", 1)
    for _ in range(paging.get("max_pages", 5000)):
        call_args = dict(args)
        if paging.get("cursor_arg") and cursor is not None:
            call_args[paging["cursor_arg"]] = cursor
        if paging.get("page_arg"):
            call_args[paging["page_arg"]] = page
        if paging.get("offset_arg"):
            call_args[paging["offset_arg"]] = len(records)
        result = client.call_tool(spec["tool"], call_args)
        fresh = {}
        for item in extract_items(result, spec.get("items"), spec["name"], spec.get("key", "id")):
            fresh.setdefault(record_key(item, spec.get("key", "id")), item)
        fresh = {k: v for k, v in fresh.items() if k not in keys}
        records += fresh.values()
        keys |= fresh.keys()
        # No paging, an empty page, or a page we already have (the server ignores the paging arg).
        if not paging or not fresh:
            return records
        if no_more(result):
            return records
        if paging.get("cursor_arg"):
            cursor_value = next_cursor(result, paging.get("next"))
            if cursor_value in (None, cursor):
                return records
            cursor = cursor_value
        page += 1
    raise McpError(f"{spec['name']}: stopped after {paging.get('max_pages', 5000)} pages")


def fetch_sql(client, plan, spec):
    """All rows of a SELECT, in LIMIT/OFFSET pages, until an empty page.

    The page size follows the row size, so a page stays under the server's cap on
    result length; a page the server cut anyway is asked again at half the size.
    """
    tool = plan["sql_tool"]
    max_size = spec.get("page_size", 500)
    budget = tool.get("max_chars", 150_000) * 0.7
    cut_marker = tool.get("cut_marker", "[Result cut at")
    row_cap = tool.get("row_cap")  # the server never returns more rows than this
    size = max_size
    key = spec.get("key", "id")
    order = spec.get("order_by") or (", ".join(key) if isinstance(key, list) else key)
    records = []
    while True:
        sql = f"SELECT * FROM ({spec['sql']}) AS t"
        sql += f" ORDER BY {order}" if order else ""
        sql += f" LIMIT {size} OFFSET {len(records)}"
        time.sleep(tool.get("delay", 0))
        result = client.call_tool(tool["name"], {**(tool.get("args") or {}), tool["arg"]: sql})
        if isinstance(result, str) and cut_marker in result:
            if size == 1:
                raise ShapeError(f"the row at offset {len(records)} alone is over the server's result limit")
            size = max(1, size // 2)
            continue
        rows = extract_items(result, tool.get("items"), spec["name"], key)
        if not rows:
            return records
        records += rows
        if row_cap and size <= row_cap and len(rows) < size:
            return records  # a short, uncut page is the last one
        if len(records) // 5000 != (len(records) - len(rows)) // 5000:
            log(f"  {len(records)} rows ...")
        per_row = len(json.dumps(rows, ensure_ascii=False, separators=(",", ":"))) / len(rows)
        size = max(1, min(max_size, int(budget / per_row)))


def fetch_for_each(client, store, spec, run_id):
    """Call a detail tool once per record of another entity (e.g. get_order per order)."""
    each = spec["for_each"]
    parents = store.records(each["from"])
    if each.get("changed_only"):
        changed = store.changed_keys(each["from"], run_id)
        have = {r.get("_parent") for r in store.records(spec["name"]) if isinstance(r, dict)}
        parent_key = each.get("parent_key", "id")
        parents = [p for p in parents if record_key(p, parent_key) in changed or get_path(p, each["field"]) not in have]
    records = []
    for parent in parents:
        value = get_path(parent, each["field"])
        if value is None:
            continue
        result = client.call_tool(spec["tool"], {**(spec.get("args") or {}), each["arg"]: value})
        for item in extract_items(result, spec.get("items"), spec["name"], spec.get("key", "id")):
            if isinstance(item, dict):
                item.setdefault("_parent", value)
            records.append(item)
    return records


# --- commands ---------------------------------------------------------------

def cmd_discover(_args):
    client = connect()
    schema = {
        "url": client.url,
        "server": client.server_info,
        "protocolVersion": client.protocol_version,
        "capabilities": client.capabilities,
        "instructions": client.instructions,
        "tools": client.list_tools(),
        "resources": client.list_resources(),
        "prompts": client.list_prompts(),
    }
    out = data_dir() / "schema.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(schema, ensure_ascii=False, indent=2))
    print(f"server: {schema['server'].get('name')} {schema['server'].get('version', '')}"
          f" (protocol {schema['protocolVersion']})")
    if schema["instructions"]:
        print("instructions:", schema["instructions"])
    print(f"{len(schema['tools'])} tools:")
    for tool in schema["tools"]:
        input_schema = tool.get("inputSchema") or {}
        required = set(input_schema.get("required") or [])
        params = [p + ("*" if p in required else "") for p in (input_schema.get("properties") or {})]
        first_line = (tool.get("description") or "").strip().splitlines()[:1]
        print(f"  {tool['name']}({', '.join(params)})  {first_line[0][:110] if first_line else ''}")
    for resource in schema["resources"]:
        print(f"  resource {resource.get('uri')}  {resource.get('name', '')}")
    print(f"saved {out}")


def entity_name(tool_name):
    name = re.sub(r"[^0-9a-zA-Z]+", "_", tool_name).strip("_").lower()
    return re.sub(r"^(crm_)?(list_all_|list_|get_all_|get_|fetch_|all_)", "", name) or name


def cmd_plan(_args):
    schema = json.loads((data_dir() / "schema.json").read_text())
    plan = {"entities": []}
    for tool in schema["tools"]:
        input_schema = tool.get("inputSchema") or {}
        props = input_schema.get("properties") or {}
        text = (tool.get("description") or "").lower()
        for arg in ("sql", "query", "statement"):
            if arg in props and ("sql" in text or "select" in text):
                plan["sql_tool"] = {"name": tool["name"], "arg": arg}
        if input_schema.get("required"):
            continue
        spec = {"name": entity_name(tool["name"]), "tool": tool["name"], "key": "id"}
        paging = {}
        for role, names in PAGING_ARGS.items():
            for name in names:
                if name in props and role not in paging:
                    paging[role] = name
        if paging.keys() - {"limit_arg"}:
            if "limit_arg" in paging:
                paging["limit"] = min(props[paging["limit_arg"]].get("maximum") or 100, 500)
            spec["paginate"] = paging
        plan["entities"].append(spec)
    path = plan_path()
    if path.exists():
        path = path.with_name("plan.draft.json")
    path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {path} with {len(plan['entities'])} entities; check it before `pull`")


def cmd_call(args):
    if not args:
        sys.exit("usage: sync.py call TOOL ['{json args}']")
    client = connect()
    result = client.call_tool(args[0], json.loads(args[1]) if len(args) > 1 else {})
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_pull(args):
    plan = json.loads(plan_path().read_text())
    full = "--full" in args
    only = {a for a in args if a != "--full"}
    client = connect()
    out = data_dir()
    (out / "raw").mkdir(parents=True, exist_ok=True)
    store = Store(out / "crm.sqlite")
    run_id = store.start_run()
    summary, failed = {}, []
    for spec in plan["entities"]:
        name = spec["name"]
        if (only and name not in only) or (spec.get("full_only") and not full and name not in only):
            continue
        log(f"{name} ...")
        try:
            if "sql" in spec:
                records = fetch_sql(client, plan, spec)
            elif "for_each" in spec:
                records = fetch_for_each(client, store, spec, run_id)
            else:
                records = fetch_tool(client, spec)
        except (AuthError, NetworkBlocked):
            store.finish_run(run_id, "failed", summary)
            raise
        except (McpError, ShapeError) as e:
            log(f"  failed: {e}")
            summary[name] = {"error": str(e)}
            failed.append(name)
            continue
        (out / "raw" / f"{name}.json").write_text(json.dumps(records, ensure_ascii=False, indent=1))
        complete = spec.get("complete", not spec.get("for_each", {}).get("changed_only"))
        counts = store.apply(run_id, name, records, spec.get("key", "id"), complete, spec.get("ignore", ()),
                             spec.get("unique", False))
        summary[name] = counts
        log("  " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    status = "ok" if not failed else "partial" if len(failed) < len(summary) else "failed"
    store.finish_run(run_id, status, summary)
    exported = store.export_csv(out / "export")
    store.close()
    print(json.dumps({"run": run_id, "status": status, "entities": summary}, ensure_ascii=False, indent=1))
    log(f"CSV: {out / 'export'} ({sum(exported.values())} rows in {len(exported)} files)")
    return 0 if status == "ok" else 1 if status == "partial" else 2


def cmd_export(_args):
    store = Store(data_dir() / "crm.sqlite")
    for entity, rows in store.export_csv(data_dir() / "export").items():
        print(f"{entity}: {rows} rows")
    store.close()


COMMANDS = {"discover": cmd_discover, "plan": cmd_plan, "call": cmd_call, "pull": cmd_pull, "export": cmd_export}


def main(argv):
    if not argv or argv[0] not in COMMANDS:
        sys.exit(__doc__)
    try:
        return COMMANDS[argv[0]](argv[1:]) or 0
    except (AuthError, NetworkBlocked) as e:
        log(f"error: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
