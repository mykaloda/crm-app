import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMcpApp } from './app';

for (const f of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(f)) {
    process.loadEnvFile(f);
    break;
  }
}

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
