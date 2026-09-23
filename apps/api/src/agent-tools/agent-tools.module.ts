import { Global, Module } from '@nestjs/common';
import { MatchingService } from '../matching/matching.service';
import { NegotiationService } from '../negotiation/negotiation.service';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentToolsController } from './agent-tools.controller';
import { AgentToolsService } from './agent-tools.service';

@Global()
@Module({
  controllers: [AgentToolsController],
  providers: [AgentToolsService, AgentAuthGuard, MatchingService, NegotiationService],
  exports: [AgentToolsService],
})
export class AgentToolsModule {}
