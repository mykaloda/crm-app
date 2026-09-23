import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { ActivityService } from './activity.service';
import { ACCESS_COOKIE, IS_PUBLIC, REQUIRE_AGE_VERIFIED, ROLES, RequestUser } from './auth.decorators';
import { PrismaService } from './prisma.service';

export function extractAccessToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return req.cookies?.[ACCESS_COOKIE];
}

/** Global guard for the web session (JWT in cookie or bearer). Agent endpoints use AgentAuthGuard instead. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const user = await resolveSessionUser(this.jwt, this.prisma, extractAccessToken(req));
    if (!user) throw new UnauthorizedException('Not authenticated');
    req.user = user;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_AGE_VERIFIED, targets) && !user.ageVerified) {
      throw new ForbiddenException({ error: 'age_verification_required', message: 'Complete 18+ verification first' });
    }
    void this.activity.touch(user.id);
    return true;
  }
}

export async function resolveSessionUser(
  jwt: JwtService,
  prisma: PrismaService,
  token: string | undefined,
): Promise<RequestUser | null> {
  if (!token) return null;
  let sub: string;
  try {
    const payload = await jwt.verifyAsync<{ sub: string; typ: string }>(token);
    if (payload.typ !== 'access') return null;
    sub = payload.sub;
  } catch {
    return null;
  }
  const u = await prisma.user.findUnique({
    where: { id: sub },
    select: { id: true, email: true, role: true, status: true, ageVerificationStatus: true, aiEnabled: true },
  });
  if (!u || u.status !== 'ACTIVE') return null;
  return { id: u.id, email: u.email, role: u.role, ageVerified: u.ageVerificationStatus === 'VERIFIED', aiEnabled: u.aiEnabled };
}
