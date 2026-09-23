import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { MetricsService } from './metrics.service';

@Module({ controllers: [AdminController], providers: [MetricsService] })
export class AdminModule {}
