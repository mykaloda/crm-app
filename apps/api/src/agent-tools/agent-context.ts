import { ChangeSource, ConnectionType } from '@prisma/client';

/** Who is acting: a user's agent, identified by its connection. */
export interface AgentContext {
  userId: string;
  connectionId?: string;
  connectionType: ConnectionType;
}

export function changeSourceFor(type: ConnectionType): ChangeSource {
  return type === 'MCP' ? 'AGENT_MCP' : type === 'CUSTOM_GPT' ? 'AGENT_GPT' : 'AGENT_BUILTIN';
}
