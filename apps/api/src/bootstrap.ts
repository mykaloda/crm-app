import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppConfig } from './config/config';

/** Shared HTTP setup for main.ts and e2e tests. */
export function configureApp(app: INestApplication, config: AppConfig) {
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '100kb' }));
  app.enableCors({
    origin: [config.WEB_URL],
    credentials: true,
  });
  app.enableShutdownHooks();
}
