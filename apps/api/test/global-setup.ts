import { execSync } from 'node:child_process';
import { join } from 'node:path';

export default async function globalSetup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/agentmatch_test';
  execSync('npx prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
