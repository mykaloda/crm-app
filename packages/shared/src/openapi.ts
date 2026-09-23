import { z } from 'zod';
import { AGENT_INSTRUCTIONS, AGENT_TOOLS, AGENT_TOOL_NAMES } from './agent-tools';

/**
 * OpenAPI 3.1 document for Custom GPT Actions. Each agent tool is one POST operation
 * whose operationId equals the tool name, so GPT and MCP share the same vocabulary.
 */
export function buildAgentOpenApi(apiUrl: string): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (const name of AGENT_TOOL_NAMES) {
    const tool = AGENT_TOOLS[name];
    const schema = z.toJSONSchema(tool.input, { target: 'openapi-3.0', io: 'input', unrepresentable: 'any' });
    delete (schema as Record<string, unknown>).$schema;
    paths[`/agent/v1/tools/${name}`] = {
      post: {
        operationId: name,
        summary: tool.title,
        description: tool.description.slice(0, 300),
        'x-openai-isConsequential': !tool.readOnly && name !== 'search_candidates',
        requestBody: { required: true, content: { 'application/json': { schema } } },
        responses: {
          '200': {
            description: 'Tool result',
            content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
          },
          '400': { description: 'Invalid input or blocked by safety filter' },
          '401': { description: 'Not authenticated' },
          '429': { description: 'Rate limited' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'AgentMatch agent API',
      version: '1.0.0',
      description: AGENT_INSTRUCTIONS,
    },
    servers: [{ url: apiUrl }],
    paths,
    components: {
      schemas: {},
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: `${apiUrl}/oauth/authorize`,
              tokenUrl: `${apiUrl}/oauth/token`,
              scopes: { 'profile agents matches': 'Manage your dating profile, negotiate and read matches' },
            },
          },
        },
      },
    },
    security: [{ oauth: ['profile agents matches'] }],
  };
}
