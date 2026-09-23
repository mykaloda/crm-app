import { Global, Module } from '@nestjs/common';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentToolsController } from './agent-tools.controller';
import { AgentToolsService } from './agent-tools.service';

@Global()
@Module({
  controllers: [AgentToolsController],
  providers: [AgentToolsService, AgentAuthGuard],
  exports: [AgentToolsService],
})
export class AgentToolsModule {}
