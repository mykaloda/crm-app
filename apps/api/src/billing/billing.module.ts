import { Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { BillingController } from './billing.controller';
import { PAYMENTS_PROVIDER, createPaymentsProvider } from './payments.provider';

@Module({
  controllers: [BillingController],
  providers: [{ provide: PAYMENTS_PROVIDER, inject: [APP_CONFIG], useFactory: (c: AppConfig) => createPaymentsProvider(c) }],
})
export class BillingModule {}
