import { Global, Module } from '@nestjs/common';
import { AFTER_MATCHING } from '../matching/matching.queue';
import { NegotiationService } from './negotiation.service';

@Global()
@Module({
  providers: [
    NegotiationService,
    { provide: AFTER_MATCHING, useValue: async () => undefined },
  ],
  exports: [NegotiationService, AFTER_MATCHING],
})
export class NegotiationModule {}
