import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { AGE_VERIFICATION_PROVIDER, createAgeVerificationProvider } from './age-verification.provider';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  controllers: [VerificationController],
  providers: [
    VerificationService,
    { provide: AGE_VERIFICATION_PROVIDER, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createAgeVerificationProvider(c) },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
