import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WEB_URL: z.string().default('http://localhost:3000'),
  API_URL: z.string().default('http://localhost:4000'),
  MCP_URL: z.string().default('http://localhost:4100'),
  PORT_API: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().refine((k) => Buffer.from(k, 'base64').length === 32, 'must be 32 bytes base64'),
  INTERNAL_API_SECRET: z.string().min(8),
  COOKIE_SECURE: bool,
  UPLOAD_DIR: z.string().default('./uploads'),

  EMBEDDINGS_PROVIDER: z.enum(['hash', 'openai']).default('hash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AGENT_LLM_PROVIDER: z.enum(['scripted', 'anthropic']).default('scripted'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),

  AGE_VERIFICATION_PROVIDER: z.enum(['mock', 'veriff', 'persona']).default('mock'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  PAYMENTS_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),

  GPT_OAUTH_CLIENT_ID: z.string().default('agentmatch-custom-gpt'),
  GPT_OAUTH_CLIENT_SECRET: z.string().default(''),

  MATCHING_DAILY_CRON: z.string().default('0 3 * * *'),
  MATCHING_ENABLE_SCHEDULER: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  NEGOTIATION_MAX_MESSAGES: z.coerce.number().int().default(10),
  RATE_LIMIT_SEARCH_PER_HOUR: z.coerce.number().int().default(30),
  RATE_LIMIT_AGENT_MESSAGES_PER_HOUR: z.coerce.number().int().default(120),
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((s) => s.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
