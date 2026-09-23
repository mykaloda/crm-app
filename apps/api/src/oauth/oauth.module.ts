import { Global, Module } from '@nestjs/common';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

@Global()
@Module({ controllers: [OAuthController], providers: [OAuthService], exports: [OAuthService] })
export class OAuthModule {}
