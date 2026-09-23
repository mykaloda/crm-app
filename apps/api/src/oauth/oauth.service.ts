import { ForbiddenException, HttpException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConnectionType, OAuthClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/config';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis.service';

export const OAUTH_SCOPE = 'profile agents matches';
const CODE_TTL_SEC = 300;
const ACCESS_TTL_SEC = 3600;
const REFRESH_TTL_SEC = 30 * 24 * 3600;
const REQUEST_TTL_SEC = 600;

/** OAuth error in RFC 6749 shape. */
export class OAuthError extends HttpException {
  constructor(error: string, description: string, status = 400) {
    super({ error, error_description: description }, status);
  }
}

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  state?: string;
  scope?: string;
  resource?: string;
}

interface PendingRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scope: string;
  resource?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

function isAllowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === 'https:') return true;
    // Loopback redirects for native/desktop clients (RFC 8252).
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/** ChatGPT Actions callback URLs contain a per-GPT id segment. */
const GPT_REDIRECT_PATTERNS = [
  /^https:\/\/chat\.openai\.com\/aip\/[\w-]+\/oauth\/callback$/,
  /^https:\/\/chatgpt\.com\/aip\/[\w-]+\/oauth\/callback$/,
];

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  metadata() {
    const base = this.config.API_URL;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: OAUTH_SCOPE.split(' '),
      service_documentation: `${this.config.WEB_URL}/connect`,
    };
  }

  /** Pre-registered confidential client for the Custom GPT. Created on first use. */
  private async ensureGptClient(): Promise<void> {
    if (!this.config.GPT_OAUTH_CLIENT_SECRET) return;
    await this.prisma.oAuthClient.upsert({
      where: { clientId: this.config.GPT_OAUTH_CLIENT_ID },
      create: {
        clientId: this.config.GPT_OAUTH_CLIENT_ID,
        clientSecretHash: this.crypto.sha256(this.config.GPT_OAUTH_CLIENT_SECRET),
        name: 'ChatGPT (Custom GPT)',
        redirectUris: [],
        dynamic: false,
        connectionType: 'CUSTOM_GPT',
      },
      update: { clientSecretHash: this.crypto.sha256(this.config.GPT_OAUTH_CLIENT_SECRET) },
    });
  }

  /** RFC 7591 dynamic client registration (used by Claude, ChatGPT connectors, MCP Inspector). */
  async register(body: { client_name?: string; redirect_uris?: unknown; token_endpoint_auth_method?: string }) {
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
    if (!uris.length || uris.length > 10 || !uris.every(isAllowedRedirect)) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https (or loopback http) URLs without fragments');
    }
    const confidential = body.token_endpoint_auth_method === 'client_secret_post' || body.token_endpoint_auth_method === 'client_secret_basic';
    const clientId = `mcp_${this.crypto.randomToken(12)}`;
    const secret = confidential ? this.crypto.randomToken(24) : undefined;
    const name = (body.client_name ?? 'MCP client').toString().slice(0, 80);
    await this.prisma.oAuthClient.create({
      data: { clientId, name, redirectUris: uris, dynamic: true, connectionType: 'MCP', clientSecretHash: secret ? this.crypto.sha256(secret) : null },
    });
    return {
      client_id: clientId,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: confidential ? body.token_endpoint_auth_method : 'none',
    };
  }

  private async client(clientId: string | undefined): Promise<OAuthClient> {
    if (clientId === this.config.GPT_OAUTH_CLIENT_ID) await this.ensureGptClient();
    const c = clientId ? await this.prisma.oAuthClient.findUnique({ where: { clientId } }) : null;
    if (!c) throw new OAuthError('invalid_client', 'Unknown client', 401);
    return c;
  }

  private redirectAllowed(client: OAuthClient, uri: string): boolean {
    if (client.connectionType === 'CUSTOM_GPT') return GPT_REDIRECT_PATTERNS.some((re) => re.test(uri));
    return client.redirectUris.includes(uri);
  }

  /**
   * Validates an authorization request and parks it in Redis. Returns the web consent URL.
   * Errors before the redirect URI is trusted are shown to the user instead of redirected.
   */
  async startAuthorization(p: AuthorizeParams): Promise<string> {
    const client = await this.client(p.client_id);
    if (!p.redirect_uri || !this.redirectAllowed(client, p.redirect_uri)) throw new OAuthError('invalid_request', 'redirect_uri not registered');
    if (p.response_type !== 'code') throw new OAuthError('unsupported_response_type', 'Only code is supported');
    const isPublic = !client.clientSecretHash;
    if (isPublic && (!p.code_challenge || p.code_challenge_method !== 'S256')) {
      throw new OAuthError('invalid_request', 'PKCE with S256 is required');
    }
    if (p.code_challenge && p.code_challenge_method && p.code_challenge_method !== 'S256') {
      throw new OAuthError('invalid_request', 'Only S256 is supported');
    }
    const id = this.crypto.randomToken(16);
    const pending: PendingRequest = {
      clientId: client.clientId,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge ?? '',
      state: p.state,
      scope: OAUTH_SCOPE,
      resource: p.resource,
    };
    await this.redis.client.set(`oauth:req:${id}`, JSON.stringify(pending), 'EX', REQUEST_TTL_SEC);
    return `${this.config.WEB_URL}/oauth/consent?request=${id}`;
  }

  private async pending(id: string): Promise<PendingRequest> {
    const raw = await this.redis.client.get(`oauth:req:${id}`);
    if (!raw) throw new NotFoundException('Authorization request expired');
    return JSON.parse(raw) as PendingRequest;
  }

  async describeRequest(id: string) {
    const p = await this.pending(id);
    const client = await this.client(p.clientId);
    return {
      clientName: client.name,
      connectionType: client.connectionType,
      redirectHost: new URL(p.redirectUri).host,
      scopes: p.scope.split(' '),
    };
  }

  /** Human approved or denied on the consent page. Returns the URL to send the browser to. */
  async decide(id: string, userId: string, approve: boolean): Promise<string> {
    const p = await this.pending(id);
    await this.redis.client.del(`oauth:req:${id}`);
    const url = new URL(p.redirectUri);
    if (p.state) url.searchParams.set('state', p.state);
    if (!approve) {
      url.searchParams.set('error', 'access_denied');
      return url.toString();
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.ageVerificationStatus !== 'VERIFIED') throw new ForbiddenException({ error: 'age_verification_required' });
    if (!user.aiEnabled) throw new ForbiddenException({ error: 'ai_disabled', message: 'Turn AI access back on in privacy settings first' });
    const aiConsent = await this.prisma.consent.count({ where: { userId, type: 'AI_PROCESSING', revokedAt: null } });
    if (!aiConsent) throw new ForbiddenException({ error: 'ai_consent_required', message: 'Consent to AI processing first' });
    const code = this.crypto.randomToken(32);
    await this.prisma.oAuthAuthCode.create({
      data: {
        codeHash: this.crypto.sha256(code),
        clientId: p.clientId,
        userId,
        redirectUri: p.redirectUri,
        codeChallenge: p.codeChallenge,
        scope: p.scope,
        resource: p.resource,
        expiresAt: new Date(Date.now() + CODE_TTL_SEC * 1000),
      },
    });
    url.searchParams.set('code', code);
    url.searchParams.set('iss', this.config.API_URL);
    return url.toString();
  }

  private async authenticateClient(clientId: string | undefined, secret: string | undefined): Promise<OAuthClient> {
    const client = await this.client(clientId);
    if (client.clientSecretHash) {
      if (!secret || !this.crypto.safeEqual(this.crypto.sha256(secret), client.clientSecretHash)) {
        throw new OAuthError('invalid_client', 'Client authentication failed', 401);
      }
    }
    return client;
  }

  async token(body: Record<string, string | undefined>, basic?: { id: string; secret: string }): Promise<TokenResponse> {
    const clientId = basic?.id ?? body.client_id;
    const secret = basic?.secret ?? body.client_secret;
    const client = await this.authenticateClient(clientId, secret);
    if (body.grant_type === 'authorization_code') return this.exchangeCode(client, body);
    if (body.grant_type === 'refresh_token') return this.refresh(client, body.refresh_token);
    throw new OAuthError('unsupported_grant_type', 'Unsupported grant_type');
  }

  private async exchangeCode(client: OAuthClient, body: Record<string, string | undefined>): Promise<TokenResponse> {
    if (!body.code) throw new OAuthError('invalid_request', 'code is required');
    const row = await this.prisma.oAuthAuthCode.findUnique({ where: { codeHash: this.crypto.sha256(body.code) } });
    if (!row || row.clientId !== client.clientId || row.expiresAt < new Date()) throw new OAuthError('invalid_grant', 'Invalid or expired code');
    if (row.usedAt) {
      // Code replay: revoke everything issued from it (RFC 6749 §4.1.2).
      await this.prisma.oAuthToken.updateMany({ where: { userId: row.userId, clientId: client.clientId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new OAuthError('invalid_grant', 'Code already used');
    }
    if (body.redirect_uri && body.redirect_uri !== row.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
    if (row.codeChallenge) {
      if (!body.code_verifier) throw new OAuthError('invalid_request', 'code_verifier is required');
      const challenge = createHash('sha256').update(body.code_verifier).digest('base64url');
      if (!this.crypto.safeEqual(challenge, row.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
    }
    const claimed = await this.prisma.oAuthAuthCode.updateMany({ where: { codeHash: row.codeHash, usedAt: null }, data: { usedAt: new Date() } });
    if (!claimed.count) throw new OAuthError('invalid_grant', 'Code already used');

    const connection =
      (await this.prisma.agentConnection.findFirst({ where: { userId: row.userId, clientId: client.clientId, revokedAt: null } })) ??
      (await this.prisma.agentConnection.create({
        data: { userId: row.userId, clientId: client.clientId, type: client.connectionType as ConnectionType, label: client.name },
      }));
    return this.issue(client.clientId, row.userId, connection.id, row.scope);
  }

  private async refresh(client: OAuthClient, refreshToken: string | undefined): Promise<TokenResponse> {
    if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
    const row = await this.prisma.oAuthToken.findUnique({ where: { refreshTokenHash: this.crypto.sha256(refreshToken) } });
    if (!row || row.clientId !== client.clientId) throw new OAuthError('invalid_grant', 'Invalid refresh token');
    if (row.revokedAt || !row.refreshExpiresAt || row.refreshExpiresAt < new Date()) {
      if (row.revokedAt) {
        await this.prisma.oAuthToken.updateMany({ where: { connectionId: row.connectionId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      throw new OAuthError('invalid_grant', 'Refresh token expired or revoked');
    }
    const [user, connection] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: row.userId } }),
      this.prisma.agentConnection.findUnique({ where: { id: row.connectionId } }),
    ]);
    if (!user?.aiEnabled || user.status !== 'ACTIVE' || !connection || connection.revokedAt) {
      throw new OAuthError('invalid_grant', 'AI access was revoked by the user');
    }
    await this.prisma.oAuthToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issue(client.clientId, row.userId, row.connectionId, row.scope);
  }

  private async issue(clientId: string, userId: string, connectionId: string, scope: string): Promise<TokenResponse> {
    const access = `am_at_${this.crypto.randomToken(32)}`;
    const refresh = `am_rt_${this.crypto.randomToken(32)}`;
    await this.prisma.oAuthToken.create({
      data: {
        accessTokenHash: this.crypto.sha256(access),
        refreshTokenHash: this.crypto.sha256(refresh),
        clientId,
        userId,
        connectionId,
        scope,
        accessExpiresAt: new Date(Date.now() + ACCESS_TTL_SEC * 1000),
        refreshExpiresAt: new Date(Date.now() + REFRESH_TTL_SEC * 1000),
      },
    });
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SEC, refresh_token: refresh, scope };
  }

  async revoke(token: string | undefined) {
    if (!token) return;
    const hash = this.crypto.sha256(token);
    await this.prisma.oAuthToken.updateMany({
      where: { OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }], revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Resolve an access token to its agent context, enforcing every revocation switch. */
  async validateAccessToken(token: string) {
    const row = await this.prisma.oAuthToken.findUnique({
      where: { accessTokenHash: this.crypto.sha256(token) },
      include: { user: true },
    });
    if (!row || row.revokedAt || row.accessExpiresAt < new Date()) throw new UnauthorizedException('invalid_token');
    if (row.user.status !== 'ACTIVE') throw new UnauthorizedException('invalid_token');
    if (!row.user.aiEnabled) throw new ForbiddenException({ error: 'ai_disabled', message: 'The user has turned off AI access' });
    const connection = await this.prisma.agentConnection.findUnique({ where: { id: row.connectionId } });
    if (!connection || connection.revokedAt) throw new UnauthorizedException('invalid_token');
    return {
      userId: row.userId,
      clientId: row.clientId,
      connectionId: row.connectionId,
      connectionType: connection.type,
      scope: row.scope,
      expiresAt: row.accessExpiresAt,
    };
  }

  /** Kill switch helper: revoke every token and connection of a user. */
  async revokeAllForUser(userId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.oAuthToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.agentConnection.updateMany({ where: { userId, revokedAt: null, type: { not: 'BUILTIN' } }, data: { revokedAt: now } }),
    ]);
  }

  async revokeConnection(userId: string, connectionId: string) {
    const now = new Date();
    const r = await this.prisma.agentConnection.updateMany({ where: { id: connectionId, userId, revokedAt: null }, data: { revokedAt: now } });
    if (!r.count) throw new NotFoundException();
    await this.prisma.oAuthToken.updateMany({ where: { connectionId, revokedAt: null }, data: { revokedAt: now } });
    return { ok: true };
  }
}
