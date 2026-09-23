import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountModule } from './account/account.module';
import { AgentToolsModule } from './agent-tools/agent-tools.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { HealthController } from './health.controller';
import { OAuthModule } from './oauth/oauth.module';
import { ProfileModule } from './profile/profile.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [CommonModule, EmbeddingsModule, AuthModule, VerificationModule, ProfileModule, AccountModule, OAuthModule, AgentToolsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
