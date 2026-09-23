import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SOCIAL_PROVIDERS, createSocialProviders } from './social-providers';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: SOCIAL_PROVIDERS, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createSocialProviders(c) },
  ],
  exports: [AuthService],
})
export class AuthModule {}
