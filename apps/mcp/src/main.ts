import { createMcpApp } from './app';

const env = process.env;
const port = Number(env.PORT_MCP ?? 4100);
const app = createMcpApp({
  apiUrl: env.API_URL ?? 'http://localhost:4000',
  apiInternalUrl: env.API_INTERNAL_URL ?? env.API_URL ?? 'http://localhost:4000',
  mcpUrl: env.MCP_URL ?? `http://localhost:${port}`,
  internalSecret: env.INTERNAL_API_SECRET ?? '',
});
if (!env.INTERNAL_API_SECRET) console.warn('INTERNAL_API_SECRET is not set; token introspection will fail');
app.listen(port, () => console.log(`MCP server listening on :${port} (POST /mcp)`));
