import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/config';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../common/auth.decorators';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { SocialIdentity } from './social-providers';

const ACCESS_TTL_SEC = 15 * 60;
const REFRESH_TTL_SEC = 30 * 24 * 3600;

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private roleFor(email: string) {
    return this.config.ADMIN_EMAILS.includes(email) ? 'ADMIN' : 'USER';
  }

  async register(email: string, password: string, locale = 'en'): Promise<User> {
    email = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');
    return this.prisma.user.create({
      data: { email, passwordHash: await this.crypto.hashPassword(password), locale, role: this.roleFor(email) },
    });
  }

  async login(email: string, password: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    const ok = await this.crypto.verifyPassword(password, user?.passwordHash);
    if (!user || !ok) throw new UnauthorizedException('Invalid email or password');
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    return user;
  }

  /** Find by provider identity, else link to an existing account with the same email, else create. */
  async loginWithIdentity(provider: 'google' | 'apple', id: SocialIdentity): Promise<User> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUserId: { provider, providerUserId: id.providerUserId } },
      include: { user: true },
    });
    let user = identity?.user;
    if (!user) {
      user =
        (await this.prisma.user.findUnique({ where: { email: id.email } })) ??
        (await this.prisma.user.create({ data: { email: id.email, role: this.roleFor(id.email) } }));
      await this.prisma.authIdentity.create({ data: { provider, providerUserId: id.providerUserId, userId: user.id } });
    }
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
    return user;
  }

  async issueSession(userId: string, userAgent?: string): Promise<IssuedSession> {
    const refreshToken = this.crypto.randomToken();
    await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: this.crypto.sha256(refreshToken),
        userAgent: userAgent?.slice(0, 200),
        expiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, typ: 'access' }, { expiresIn: ACCESS_TTL_SEC });
    return { accessToken, refreshToken };
  }

  /** Rotates the refresh token. Reuse of a revoked token revokes all of the user's sessions. */
  async refresh(refreshToken: string | undefined, userAgent?: string): Promise<IssuedSession & { userId: string }> {
    if (!refreshToken) throw new UnauthorizedException('No refresh token');
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.crypto.sha256(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException('Invalid refresh token');
    if (session.revokedAt) {
      await this.prisma.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (session.expiresAt < new Date() || session.user.status !== 'ACTIVE') throw new UnauthorizedException('Session expired');
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return { ...(await this.issueSession(session.userId, userAgent)), userId: session.userId };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: this.crypto.sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  setCookies(res: Response, s: IssuedSession) {
    const base = { httpOnly: true, sameSite: 'lax' as const, secure: this.config.COOKIE_SECURE };
    res.cookie(ACCESS_COOKIE, s.accessToken, { ...base, path: '/', maxAge: ACCESS_TTL_SEC * 1000 });
    res.cookie(REFRESH_COOKIE, s.refreshToken, { ...base, path: '/auth', maxAge: REFRESH_TTL_SEC * 1000 });
  }

  clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }
}
