import { Global, Logger, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AGENT_LLM } from './agent-llm';
import { AnthropicAgent } from './anthropic-agent';
import { ScriptedAgent } from './scripted-agent';

@Global()
@Module({
  providers: [
    {
      provide: AGENT_LLM,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => {
        if (c.AGENT_LLM_PROVIDER === 'anthropic' && c.ANTHROPIC_API_KEY) return new AnthropicAgent(c.ANTHROPIC_API_KEY, c.ANTHROPIC_MODEL);
        if (c.AGENT_LLM_PROVIDER === 'anthropic') new Logger('AgentLLM').warn('ANTHROPIC_API_KEY missing; using the scripted agent');
        return new ScriptedAgent();
      },
    },
  ],
  exports: [AGENT_LLM],
})
export class AgentLlmModule {}
