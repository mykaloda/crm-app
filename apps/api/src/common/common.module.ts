import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_CONFIG, AppConfig, loadConfig } from '../config/config';
import { ActivityService } from './activity.service';
import { ConsentService } from './consent.service';
import { CryptoService } from './crypto.service';
import { PrismaService } from './prisma.service';
import { RateLimitService } from './rate-limit.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({ secret: c.JWT_SECRET, signOptions: { issuer: c.API_URL } }),
      extraProviders: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
    }),
  ],
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    PrismaService,
    CryptoService,
    RedisService,
    RateLimitService,
    ActivityService,
    ConsentService,
  ],
  exports: [APP_CONFIG, PrismaService, CryptoService, RedisService, RateLimitService, ActivityService, ConsentService],
})
export class CommonModule {}
