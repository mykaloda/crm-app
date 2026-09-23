import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AlgorithmConfigService } from './algorithm-config.service';
import { MatchingController } from './matching.controller';
import { MATCHING_QUEUE, MatchingProcessor, MatchingScheduler } from './matching.queue';
import { MatchingService } from './matching.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: MATCHING_QUEUE })],
  controllers: [MatchingController],
  providers: [MatchingService, AlgorithmConfigService, MatchingScheduler, MatchingProcessor],
  exports: [MatchingService, AlgorithmConfigService, MatchingScheduler],
})
export class MatchingModule {}
