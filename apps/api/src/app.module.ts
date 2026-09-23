import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountModule } from './account/account.module';
import { AdminModule } from './admin/admin.module';
import { BillingModule } from './billing/billing.module';
import { AgentLlmModule } from './agent-llm/agent-llm.module';
import { AgentToolsModule } from './agent-tools/agent-tools.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './common/auth.guard';
import { ChatModule } from './chat/chat.module';
import { FeedModule } from './feed/feed.module';
import { APP_CONFIG, AppConfig } from './config/config';
import { CommonModule } from './common/common.module';
import { EmbeddingsModule } from './embeddings/embeddings.module';
import { HealthController } from './health.controller';
import { InterviewModule } from './interview/interview.module';
import { MatchingModule } from './matching/matching.module';
import { NegotiationModule } from './negotiation/negotiation.module';
import { OAuthModule } from './oauth/oauth.module';
import { PrivacyModule } from './privacy/privacy.module';
import { ProfileModule } from './profile/profile.module';
import { SafetyModule } from './safety/safety.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    CommonModule,
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => {
        const u = new URL(c.REDIS_URL);
        return {
          connection: {
            host: u.hostname,
            port: Number(u.port || 6379),
            username: u.username || undefined,
            password: u.password || undefined,
            db: Number(u.pathname.slice(1) || 0),
            maxRetriesPerRequest: null,
          },
          prefix: c.NODE_ENV === 'test' ? 'bull-test' : 'bull',
        };
      },
    }),
    EmbeddingsModule,
    AuthModule,
    VerificationModule,
    ProfileModule,
    AccountModule,
    OAuthModule,
    AgentToolsModule,
    MatchingModule,
    NegotiationModule,
    AgentLlmModule,
    InterviewModule,
    FeedModule,
    ChatModule,
    SafetyModule,
    PrivacyModule,
    AdminModule,
    BillingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
