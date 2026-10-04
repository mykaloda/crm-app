"""Minimal MCP client for the Streamable HTTP transport, standard library only."""

import json
import time
import urllib.error
import urllib.request

PROTOCOL_VERSION = "2025-06-18"
RETRY_DELAYS = (2, 4, 8, 16)
RETRY_STATUSES = {429, 500, 502, 503, 504}


class McpError(Exception):
    """Anything that went wrong talking to the server."""


class AuthError(McpError):
    """The server rejected the key: wrong, or switched off in Settings -> Channels."""


class NetworkBlocked(McpError):
    """The session's egress proxy refused the host (environment network policy)."""


class ToolError(McpError):
    """The tool ran and reported an error (isError: true)."""


class _SessionExpired(Exception):
    pass


class McpClient:
    def __init__(self, url, key, timeout=90, client_name="lerega-crm-sync"):
        self.url = url
        self.key = key
        self.timeout = timeout
        self.client_name = client_name
        self.session_id = None
        self.protocol_version = None
        self.server_info = {}
        self.capabilities = {}
        self.instructions = None
        self._next_id = 0

    # --- transport -------------------------------------------------------

    def _headers(self):
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self.key}",
            "User-Agent": f"{self.client_name}/1.0",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        if self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        return headers

    def _post(self, message):
        """POST one JSON-RPC message and return the open response; retries transient failures."""
        body = json.dumps(message).encode()
        for delay in (*RETRY_DELAYS, None):
            request = urllib.request.Request(self.url, data=body, headers=self._headers(), method="POST")
            try:
                return urllib.request.urlopen(request, timeout=self.timeout)
            except urllib.error.HTTPError as e:
                detail = e.read()[:300].decode("utf-8", "replace").strip()
                if e.code in (401, 403):
                    raise AuthError(f"HTTP {e.code}: the server rejected the key. {detail}") from None
                if e.code == 404 and self.session_id and message.get("method") != "initialize":
                    raise _SessionExpired() from None
                if e.code in RETRY_STATUSES and delay is not None:
                    time.sleep(delay)
                    continue
                raise McpError(f"HTTP {e.code} from {self.url}: {detail}") from None
            except urllib.error.URLError as e:
                reason = str(e.reason)
                if "Tunnel connection failed" in reason:
                    raise NetworkBlocked(
                        f"the proxy refused the connection to {self.url} ({reason}). "
                        "The host must be added to the environment's allowed domains."
                    ) from None
                if delay is None:
                    raise McpError(f"network error: {reason}") from None
                time.sleep(delay)
            except (TimeoutError, ConnectionError) as e:
                if delay is None:
                    raise McpError(f"network error: {e}") from None
                time.sleep(delay)

    @staticmethod
    def _read_sse(response, want_id):
        """Read SSE events until the JSON-RPC reply with id == want_id; skip notifications."""
        data = []

        def take():
            message = json.loads("\n".join(data))
            data.clear()
            if isinstance(message, dict) and message.get("id") == want_id:
                if "result" in message or "error" in message:
                    return message
            return None

        for raw in response:
            line = raw.decode("utf-8").rstrip("\r\n")
            if not line:
                if data and (reply := take()):
                    return reply
                continue
            if line.startswith(":"):
                continue
            field, _, value = line.partition(":")
            if field == "data":
                data.append(value[1:] if value.startswith(" ") else value)
        return take() if data else None

    def _exchange(self, message):
        with self._post(message) as response:
            if sid := response.headers.get("Mcp-Session-Id"):
                self.session_id = sid
            if "id" not in message:
                response.read()
                return None
            if "text/event-stream" in response.headers.get("Content-Type", ""):
                return self._read_sse(response, message["id"])
            raw = response.read()
        reply = json.loads(raw) if raw.strip() else None
        if isinstance(reply, list):
            reply = next((r for r in reply if r.get("id") == message["id"]), None)
        return reply

    def request(self, method, params=None):
        self._next_id += 1
        message = {"jsonrpc": "2.0", "id": self._next_id, "method": method}
        if params is not None:
            message["params"] = params
        try:
            reply = self._exchange(message)
        except _SessionExpired:
            self.initialize()
            reply = self._exchange(message)
        if reply is None:
            raise McpError(f"{method}: the server sent no reply")
        if "error" in reply:
            error = reply["error"]
            raise McpError(f"{method}: {error.get('message')} (code {error.get('code')})")
        return reply.get("result") or {}

    def notify(self, method, params=None):
        message = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._exchange(message)

    # --- protocol --------------------------------------------------------

    def initialize(self):
        self.session_id = None
        self.protocol_version = None
        result = self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": self.client_name, "version": "1.0"},
        })
        self.protocol_version = result.get("protocolVersion") or PROTOCOL_VERSION
        self.server_info = result.get("serverInfo") or {}
        self.capabilities = result.get("capabilities") or {}
        self.instructions = result.get("instructions")
        self.notify("notifications/initialized")
        return result

    def _list_all(self, method, field):
        items, cursor = [], None
        while True:
            result = self.request(method, {"cursor": cursor} if cursor else {})
            items += result.get(field) or []
            next_cursor = result.get("nextCursor")
            if not next_cursor or next_cursor == cursor:
                return items
            cursor = next_cursor

    def list_tools(self):
        return self._list_all("tools/list", "tools")

    def list_resources(self):
        return self._list_all("resources/list", "resources") if "resources" in self.capabilities else []

    def list_prompts(self):
        return self._list_all("prompts/list", "prompts") if "prompts" in self.capabilities else []

    def read_resource(self, uri):
        result = self.request("resources/read", {"uri": uri})
        texts = [c.get("text", "") for c in result.get("contents", []) if "text" in c]
        return parse_text_blocks(texts)

    def call_tool(self, name, arguments=None):
        result = self.request("tools/call", {"name": name, "arguments": arguments or {}})
        texts = [c.get("text", "") for c in result.get("content") or [] if c.get("type") == "text"]
        if result.get("isError"):
            raise ToolError(f"{name}: {' '.join(texts)[:500]}")
        if result.get("structuredContent") is not None:
            return result["structuredContent"]
        return parse_text_blocks(texts)


def parse_text_blocks(texts):
    """Text content as JSON when it is JSON: one block -> value, several JSON blocks -> list."""
    if not texts:
        return None
    if len(texts) == 1:
        try:
            return json.loads(texts[0])
        except ValueError:
            return texts[0]
    try:
        return [json.loads(t) for t in texts]
    except ValueError:
        return "\n".join(texts)
