"""A small Streamable HTTP MCP server with fake CRM data, for the tests."""

import json
import sqlite3
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

KEY = "test-key"

TOOLS = [
    {"name": "list_orders", "description": "Orders, newest first.",
     "inputSchema": {"type": "object", "properties": {"cursor": {"type": "string"},
                                                      "limit": {"type": "integer", "maximum": 3}}}},
    {"name": "list_clients", "description": "Clients by page.",
     "inputSchema": {"type": "object", "properties": {"page": {"type": "integer"}, "per_page": {"type": "integer"}}}},
    {"name": "get_order", "description": "One order with its stage history.",
     "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}},
    {"name": "run_sql", "description": "Run a read-only SQL SELECT.",
     "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "broken", "description": "Always fails.", "inputSchema": {"type": "object", "properties": {}}},
]


class FakeCrm:
    def __init__(self):
        self.db = sqlite3.connect(":memory:", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            CREATE TABLE orders (id INTEGER PRIMARY KEY, stage TEXT, total REAL, city TEXT);
            CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT);
        """)
        for i in range(1, 8):
            self.db.execute("INSERT INTO orders VALUES (?, ?, ?, ?)", (i, "new", 100.0 * i, "Чикаго"))
        for i in range(1, 6):
            self.db.execute("INSERT INTO clients VALUES (?, ?)", (i, f"Клиент {i}"))
        self.lock = threading.Lock()

    def rows(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args)]

    def execute(self, sql, args=()):
        with self.lock:
            self.db.execute(sql, args)

    def call(self, name, args):
        if name == "list_orders":
            limit = min(int(args.get("limit") or 3), 3)  # caps the page like real servers do
            after = int(args.get("cursor") or 0)
            items = self.rows("SELECT * FROM orders WHERE id > ? ORDER BY id LIMIT ?", (after, limit))
            more = len(self.rows("SELECT id FROM orders WHERE id > ?", (items[-1]["id"] if items else after,)))
            orders = [{"id": o["id"], "stage": o["stage"], "total": o["total"], "client": {"city": o["city"]}}
                      for o in items]
            return {"orders": orders,
                    "nextCursor": str(items[-1]["id"]) if items and more else None}
        if name == "list_clients":
            page, per_page = int(args.get("page") or 1), int(args.get("per_page") or 2)
            return {"items": self.rows("SELECT * FROM clients ORDER BY id LIMIT ? OFFSET ?",
                                       (per_page, (page - 1) * per_page)), "page": page}
        if name == "get_order":
            order = self.rows("SELECT * FROM orders WHERE id = ?", (args["id"],))
            return {**order[0], "history": [{"stage": "new"}]} if order else None
        if name == "run_sql":
            sql = args["query"]
            if not sql.lstrip().upper().startswith("SELECT"):
                raise ValueError("read-only")
            return {"rows": self.rows(sql)[:4]}  # the server caps rows below the LIMIT asked
        if name == "run_sql_wide":
            return self.rows(args["query"])
        raise ValueError(f"tool {name} failed")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body=None, headers=()):
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        if body is None:
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.server.mode == "sse":
            note = {"jsonrpc": "2.0", "method": "notifications/message", "params": {"level": "info", "data": "hi"}}
            payload = f": ping\n\nevent: message\ndata: {json.dumps(note)}\n\ndata: {json.dumps(body)}\n\n".encode()
            self.send_header("Content-Type", "text/event-stream")
        else:
            payload = json.dumps(body).encode()
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self):
        server = self.server
        server.requests += 1
        if server.fail_next:
            server.fail_next -= 1
            return self.send(503, {"error": "busy"})
        if self.headers.get("Authorization") != f"Bearer {KEY}":
            return self.send(401, {"error": "invalid key"})
        message = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        method, msg_id = message.get("method"), message.get("id")
        if method == "initialize":
            sid = uuid.uuid4().hex
            server.sessions.add(sid)
            server.initializations += 1
            return self.send(200, {"jsonrpc": "2.0", "id": msg_id, "result": {
                "protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                "serverInfo": {"name": "mock-crm", "version": "0.1"}, "instructions": "Read-only."}},
                [("Mcp-Session-Id", sid)])
        if self.headers.get("Mcp-Session-Id") not in server.sessions:
            return self.send(404, {"error": "session not found"})
        if server.expire_after and server.requests >= server.expire_after:
            server.expire_after = 0
            server.sessions.clear()
            return self.send(404, {"error": "session expired"})
        if msg_id is None:
            return self.send(202)
        if method == "tools/list":
            start = int((message.get("params") or {}).get("cursor") or 0)
            result = {"tools": TOOLS[start:start + 2]}
            if start + 2 < len(TOOLS):
                result["nextCursor"] = str(start + 2)
            return self.send(200, {"jsonrpc": "2.0", "id": msg_id, "result": result})
        if method == "tools/call":
            params = message["params"]
            server.calls.append((params["name"], params.get("arguments") or {}))
            try:
                value = server.crm.call(params["name"], params.get("arguments") or {})
            except Exception as e:
                result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
            else:
                body = json.dumps(value, ensure_ascii=False)
                if server.max_chars and len(body) > server.max_chars:
                    body = body[:server.max_chars] + f"\n\n[Result cut at {server.max_chars} characters]"
                text = {"type": "text", "text": body}
                result = {"content": [text], "structuredContent": value} if params["name"] == "list_clients" \
                    else {"content": [text]}
            return self.send(200, {"jsonrpc": "2.0", "id": msg_id, "result": result})
        return self.send(200, {"jsonrpc": "2.0", "id": msg_id, "error": {"code": -32601, "message": "no method"}})


def start(mode="json"):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.mode = mode
    server.crm = FakeCrm()
    server.sessions = set()
    server.requests = 0
    server.initializations = 0
    server.expire_after = 0
    server.fail_next = 0
    server.max_chars = 0
    server.calls = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/api/mcp"
