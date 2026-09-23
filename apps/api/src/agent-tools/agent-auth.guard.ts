import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ActivityService } from '../common/activity.service';
import { PrismaService } from '../common/prisma.service';
import { OAuthService } from '../oauth/oauth.service';
import { AgentContext } from './agent-context';

/** Authenticates OAuth access tokens issued to external agents (MCP, Custom GPT). */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    private readonly oauth: OAuthService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { agent?: AgentContext }>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('invalid_token');
    const t = await this.oauth.validateAccessToken(header.slice(7));
    req.agent = { userId: t.userId, connectionId: t.connectionId, connectionType: t.connectionType };
    void this.prisma.agentConnection.update({ where: { id: t.connectionId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    void this.activity.touch(t.userId);
    return true;
  }
}
