import { BadRequestException, Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Public, REFRESH_COOKIE } from '../common/auth.decorators';
import { CryptoService } from '../common/crypto.service';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { SOCIAL_PROVIDERS, SocialProviders } from './social-providers';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  locale: z.enum(['en', 'ru']).optional(),
});
type Credentials = z.infer<typeof credentials>;

const STATE_COOKIE = 'am_oauth_state';
const providerParam = z.enum(['google', 'apple']);

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly crypto: CryptoService,
    private readonly rateLimit: RateLimitService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SOCIAL_PROVIDERS) private readonly providers: SocialProviders,
  ) {}

  @Post('register')
  async register(@Body(new ZodPipe(credentials)) body: Credentials, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.rateLimit.consume(`register:${req.ip}`, 20, 3600, 'registration');
    const user = await this.auth.register(body.email, body.password, body.locale);
    const s = await this.auth.issueSession(user.id, req.headers['user-agent']);
    this.auth.setCookies(res, s);
    return { userId: user.id, accessToken: s.accessToken };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(credentials)) body: Credentials, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.rateLimit.consume(`login:${req.ip}:${body.email}`, 10, 900, 'login attempts');
    const user = await this.auth.login(body.email, body.password);
    const s = await this.auth.issueSession(user.id, req.headers['user-agent']);
    this.auth.setCookies(res, s);
    return { userId: user.id, accessToken: s.accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const s = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken, req.headers['user-agent']);
    this.auth.setCookies(res, s);
    return { userId: s.userId, accessToken: s.accessToken };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    this.auth.clearCookies(res);
    return { ok: true };
  }

  @Get('providers')
  listProviders() {
    return Object.values(this.providers).map((p) => ({ name: p!.name, mock: p!.isMock }));
  }

  @Get(':provider/start')
  start(@Param('provider') provider: string, @Res() res: Response) {
    const p = this.provider(provider);
    const state = this.crypto.randomToken(16);
    // SameSite=None (secure only) so Apple's cross-site form_post callback still carries the state cookie.
    const sameSite = this.config.COOKIE_SECURE ? 'none' : 'lax';
    res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite, secure: this.config.COOKIE_SECURE, maxAge: 600_000, path: '/auth' });
    res.redirect(p.authorizeUrl(state, this.callbackUrl(p.name)));
  }

  @Get(':provider/callback')
  async callbackGet(@Param('provider') provider: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    return this.finish(provider, q.code, q.state, req, res);
  }

  /** Apple uses response_mode=form_post. */
  @Post(':provider/callback')
  async callbackPost(@Param('provider') provider: string, @Body() b: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    return this.finish(provider, b.code, b.state, req, res);
  }

  @Get('mock/:provider/authorize')
  mockAuthorize(@Param('provider') provider: string, @Query('state') state: string, @Res() res: Response) {
    const p = this.provider(provider);
    if (!p.isMock) throw new NotFoundException();
    res.type('html').send(`<!doctype html><html><body style="font-family:sans-serif;max-width:420px;margin:60px auto">
<h2>Mock ${escapeHtml(p.name)} sign-in (development only)</h2>
<form method="post"><input type="hidden" name="state" value="${escapeHtml(state ?? '')}">
<label>Email <input name="email" type="email" required style="width:100%"></label><br><br>
<button type="submit">Continue</button></form></body></html>`);
  }

  @Post('mock/:provider/authorize')
  mockAuthorizeSubmit(@Param('provider') provider: string, @Body() body: { email?: string; state?: string }, @Res() res: Response) {
    const p = this.provider(provider);
    if (!p.isMock || !body.email) throw new NotFoundException();
    const code = Buffer.from(body.email.trim()).toString('base64url');
    const qs = new URLSearchParams({ code, state: body.state ?? '' });
    res.redirect(`${this.callbackUrl(p.name)}?${qs}`);
  }

  private provider(name: string) {
    const parsed = providerParam.safeParse(name);
    const p = parsed.success ? this.providers[parsed.data] : undefined;
    if (!p) throw new NotFoundException('Unknown or disabled provider');
    return p;
  }

  private callbackUrl(name: string) {
    return `${this.config.API_URL}/auth/${name}/callback`;
  }

  private async finish(provider: string, code: string | undefined, state: string | undefined, req: Request, res: Response) {
    const p = this.provider(provider);
    const expected = req.cookies?.[STATE_COOKIE];
    if (!code || !state || !expected || !this.crypto.safeEqual(state, expected)) {
      throw new BadRequestException('Invalid OAuth state');
    }
    const identity = await p.exchange(code, this.callbackUrl(p.name));
    const user = await this.auth.loginWithIdentity(p.name, identity);
    this.auth.setCookies(res, await this.auth.issueSession(user.id, req.headers['user-agent']));
    res.clearCookie(STATE_COOKIE, { path: '/auth' });
    res.redirect(`${this.config.WEB_URL}/onboarding`);
  }
}
