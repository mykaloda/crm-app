import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load .env for local runs (Docker passes real env vars; existing vars always win). */
export function loadDotEnv() {
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}
