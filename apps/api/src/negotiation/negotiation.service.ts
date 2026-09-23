import { Injectable, NotImplementedException } from '@nestjs/common';
import { AgentContext } from '../agent-tools/agent-context';

/** Placeholder until the negotiation module lands (stage 4). */
@Injectable()
export class NegotiationService {
  async sendMessage(_ctx: AgentContext, _candidateId: string, _kind: string, _content: string): Promise<unknown> {
    throw new NotImplementedException('send_agent_message arrives with the negotiation module');
  }
  async getMessages(_ctx: AgentContext, _candidateId: string | undefined, _unreadOnly: boolean): Promise<unknown> {
    throw new NotImplementedException('get_agent_messages arrives with the negotiation module');
  }
  async submitVerdict(_ctx: AgentContext, _candidateId: string, _verdict: string, _rationale: string): Promise<unknown> {
    throw new NotImplementedException('propose_match arrives with the negotiation module');
  }
}
