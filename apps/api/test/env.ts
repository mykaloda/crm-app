// Loaded before every e2e test file.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? 'postgresql://postgres:postgres@localhost:5432/agentmatch_test';
process.env.REDIS_URL = process.env.REDIS_URL_TEST ?? 'redis://localhost:6379/1';
process.env.JWT_SECRET = 'test-jwt-secret-test-jwt-secret-test-jwt';
process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.INTERNAL_API_SECRET = 'test-internal-secret';
process.env.API_URL = 'http://localhost:4000';
process.env.WEB_URL = 'http://localhost:3000';
process.env.MCP_URL = 'http://localhost:4100';
process.env.EMBEDDINGS_PROVIDER = 'hash';
process.env.AGENT_LLM_PROVIDER = 'scripted';
process.env.AGE_VERIFICATION_PROVIDER = 'mock';
process.env.MATCHING_ENABLE_SCHEDULER = 'false';
process.env.UPLOAD_DIR = '/tmp/agentmatch-test-uploads';
process.env.ADMIN_EMAILS = 'admin@test.local';
process.env.GPT_OAUTH_CLIENT_SECRET = 'gpt-secret';
process.env.NEGOTIATION_AUTORUN = process.env.NEGOTIATION_AUTORUN ?? 'false';
