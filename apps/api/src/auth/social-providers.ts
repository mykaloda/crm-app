import { BadRequestException } from '@nestjs/common';
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'jose';
import { AppConfig } from '../config/config';

export interface SocialIdentity {
  providerUserId: string;
  email: string;
}

export interface SocialProvider {
  readonly name: 'google' | 'apple';
  readonly isMock: boolean;
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, redirectUri: string): Promise<SocialIdentity>;
}

class GoogleProvider implements SocialProvider {
  readonly name = 'google' as const;
  readonly isMock = false;
  private jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  constructor(private readonly clientId: string, private readonly clientSecret: string) {}

  authorizeUrl(state: string, redirectUri: string) {
    const p = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  }

  async exchange(code: string, redirectUri: string): Promise<SocialIdentity> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new BadRequestException('Google token exchange failed');
    const { id_token } = (await res.json()) as { id_token: string };
    const { payload } = await jwtVerify(id_token, this.jwks, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.clientId,
    });
    if (!payload.email || payload.email_verified === false) throw new BadRequestException('Google email not verified');
    return { providerUserId: String(payload.sub), email: String(payload.email).toLowerCase() };
  }
}

class AppleProvider implements SocialProvider {
  readonly name = 'apple' as const;
  readonly isMock = false;
  private jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  constructor(private readonly c: AppConfig) {}

  authorizeUrl(state: string, redirectUri: string) {
    const p = new URLSearchParams({
      client_id: this.c.APPLE_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'form_post',
      scope: 'email',
      state,
    });
    return `https://appleid.apple.com/auth/authorize?${p}`;
  }

  private async clientSecret(): Promise<string> {
    const key = await importPKCS8(this.c.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n'), 'ES256');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: this.c.APPLE_KEY_ID })
      .setIssuer(this.c.APPLE_TEAM_ID!)
      .setSubject(this.c.APPLE_CLIENT_ID!)
      .setAudience('https://appleid.apple.com')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
  }

  async exchange(code: string, redirectUri: string): Promise<SocialIdentity> {
    const res = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.c.APPLE_CLIENT_ID!,
        client_secret: await this.clientSecret(),
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) throw new BadRequestException('Apple token exchange failed');
    const { id_token } = (await res.json()) as { id_token: string };
    const { payload } = await jwtVerify(id_token, this.jwks, {
      issuer: 'https://appleid.apple.com',
      audience: this.c.APPLE_CLIENT_ID,
    });
    if (!payload.email) throw new BadRequestException('Apple did not return an email');
    return { providerUserId: String(payload.sub), email: String(payload.email).toLowerCase() };
  }
}

/**
 * Dev-only provider used when no client id is configured. The "authorize" page is
 * served by the API itself and simply asks for an email address.
 */
class MockProvider implements SocialProvider {
  readonly isMock = true;
  constructor(readonly name: 'google' | 'apple', private readonly apiUrl: string) {}

  authorizeUrl(state: string, redirectUri: string) {
    const p = new URLSearchParams({ state, redirect_uri: redirectUri });
    return `${this.apiUrl}/auth/mock/${this.name}/authorize?${p}`;
  }

  async exchange(code: string): Promise<SocialIdentity> {
    const email = Buffer.from(code, 'base64url').toString('utf8').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new BadRequestException('Invalid mock code');
    return { providerUserId: `mock-${this.name}-${email}`, email };
  }
}

export type SocialProviders = Partial<Record<'google' | 'apple', SocialProvider>>;

/** Real provider when configured, mock in non-production, otherwise disabled. */
export function createSocialProviders(c: AppConfig): SocialProviders {
  const allowMock = c.NODE_ENV !== 'production';
  const out: SocialProviders = {};
  if (c.GOOGLE_CLIENT_ID) out.google = new GoogleProvider(c.GOOGLE_CLIENT_ID, c.GOOGLE_CLIENT_SECRET ?? '');
  else if (allowMock) out.google = new MockProvider('google', c.API_URL);
  if (c.APPLE_CLIENT_ID) out.apple = new AppleProvider(c);
  else if (allowMock) out.apple = new MockProvider('apple', c.API_URL);
  return out;
}

export const SOCIAL_PROVIDERS = Symbol('SOCIAL_PROVIDERS');
