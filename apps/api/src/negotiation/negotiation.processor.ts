import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BuiltinAgentService } from './builtin-agent.service';
import { NEGOTIATION_QUEUE } from './negotiation.service';

@Processor(NEGOTIATION_QUEUE, { concurrency: 8 })
export class NegotiationProcessor extends WorkerHost {
  private readonly log = new Logger(NegotiationProcessor.name);
  constructor(private readonly agent: BuiltinAgentService) {
    super();
  }

  async process(job: Job<{ matchId: string; userId?: string }>) {
    if (job.name === 'turn' && job.data.userId) return this.agent.takeTurn(job.data.matchId, job.data.userId);
    if (job.name === 'explain') return this.agent.explain(job.data.matchId);
    this.log.warn(`Unknown job ${job.name}`);
    return null;
  }
}
