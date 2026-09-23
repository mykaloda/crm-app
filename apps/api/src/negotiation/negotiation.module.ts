import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AFTER_MATCHING } from '../matching/matching.queue';
import { BuiltinAgentService } from './builtin-agent.service';
import { NegotiationController } from './negotiation.controller';
import { NegotiationProcessor } from './negotiation.processor';
import { NEGOTIATION_QUEUE, NegotiationService } from './negotiation.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: NEGOTIATION_QUEUE })],
  controllers: [NegotiationController],
  providers: [
    NegotiationService,
    BuiltinAgentService,
    NegotiationProcessor,
    {
      provide: AFTER_MATCHING,
      inject: [NegotiationService],
      useFactory: (n: NegotiationService) => async (userId: string, matchIds: string[]) => {
        for (const id of matchIds) await n.start(id, userId);
      },
    },
  ],
  exports: [NegotiationService, BuiltinAgentService, AFTER_MATCHING],
})
export class NegotiationModule {}
