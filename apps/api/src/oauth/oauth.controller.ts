import { Body, Controller, Delete, ForbiddenException, Get, Header, Headers, HttpCode, Inject, Ip, Param, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { CurrentUser, Public, RequestUser, RequireAgeVerified } from '../common/auth.decorators';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuthorizeParams, OAuthService } from './oauth.service';

const decisionBody = z.object({ approve: z.boolean() });

function parseBasic(header: string | undefined): { id: string; secret: string } | undefined {
  if (!header?.startsWith('Basic ')) return undefined;
  const [id, secret] = Buffer.from(header.slice(6), 'base64').toString().split(':');
  return id ? { id: decodeURIComponent(id), secret: decodeURIComponent(secret ?? '') } : undefined;
}

@Controller()
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('.well-known/oauth-authorization-server')
  metadata() {
    return this.oauth.metadata();
  }

  @Public()
  @Get('.well-known/openid-configuration')
  openid() {
    return this.oauth.metadata();
  }

  @Public()
  @Post('oauth/register')
  @Header('Cache-Control', 'no-store')
  async register(@Body() body: Record<string, unknown>, @Ip() ip: string) {
    await this.rateLimit.consume(`dcr:${ip}`, 30, 3600, 'client registration');
    return this.oauth.register(body as never);
  }

  @Public()
  @Get('oauth/authorize')
  async authorize(@Query() q: AuthorizeParams, @Res() res: Response) {
    res.redirect(await this.oauth.startAuthorization(q));
  }

  @Get('oauth/requests/:id')
  describe(@Param('id') id: string) {
    return this.oauth.describeRequest(id);
  }

  @RequireAgeVerified()
  @Post('oauth/requests/:id/decision')
  @HttpCode(200)
  async decide(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodPipe(decisionBody)) body: z.infer<typeof decisionBody>) {
    return { redirectUrl: await this.oauth.decide(id, user.id, body.approve) };
  }

  @Public()
  @Post('oauth/token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  token(@Body() body: Record<string, string>, @Headers('authorization') auth?: string) {
    return this.oauth.token(body, parseBasic(auth));
  }

  @Public()
  @Post('oauth/revoke')
  @HttpCode(200)
  async revoke(@Body() body: { token?: string }) {
    await this.oauth.revoke(body.token);
    return {};
  }

  /** Used by the MCP server to validate bearer tokens. Protected by a shared secret. */
  @Public()
  @Post('oauth/introspect')
  @HttpCode(200)
  async introspect(@Body() body: { token?: string }, @Headers('x-internal-secret') secret?: string) {
    if (!secret || !this.crypto.safeEqual(secret, this.config.INTERNAL_API_SECRET)) throw new ForbiddenException();
    try {
      const t = await this.oauth.validateAccessToken(body.token ?? '');
      return { active: true, sub: t.userId, client_id: t.clientId, scope: t.scope, exp: Math.floor(t.expiresAt.getTime() / 1000) };
    } catch {
      return { active: false };
    }
  }

  @Get('connections')
  async connections(@CurrentUser() user: RequestUser) {
    const rows = await this.prisma.agentConnection.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } });
    return rows.map((c) => ({ id: c.id, type: c.type, label: c.label, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt, revokedAt: c.revokedAt }));
  }

  @Delete('connections/:id')
  revokeConnection(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.oauth.revokeConnection(user.id, id);
  }
}
