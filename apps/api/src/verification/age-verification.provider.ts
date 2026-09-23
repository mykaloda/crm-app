import { NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../config/config';

export interface AgeCheckSession {
  externalId: string;
  /** Where to send the user to complete the check. */
  redirectUrl: string;
}

export interface AgeCheckResult {
  externalId: string;
  approved: boolean;
  birthDate?: string;
  reason?: string;
}

/** Adapter for an identity/age verification vendor (Veriff, Persona, ...). */
export interface AgeVerificationProvider {
  readonly name: string;
  createSession(userId: string): Promise<AgeCheckSession>;
  /** Validate and parse a vendor webhook. Throws on bad signature. */
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<AgeCheckResult>;
}

export const AGE_VERIFICATION_PROVIDER = Symbol('AGE_VERIFICATION_PROVIDER');

/** Development provider: the web app shows a form, the "vendor result" is posted back directly. */
export class MockAgeVerificationProvider implements AgeVerificationProvider {
  readonly name = 'mock';
  constructor(private readonly webUrl: string) {}

  async createSession(): Promise<AgeCheckSession> {
    const externalId = `mock_${randomUUID()}`;
    return { externalId, redirectUrl: `${this.webUrl}/onboarding/verify/mock?session=${externalId}` };
  }

  async parseWebhook(_headers: Record<string, unknown>, body: unknown): Promise<AgeCheckResult> {
    const b = body as { sessionId?: string; birthDate?: string };
    if (!b.sessionId || !b.birthDate) throw new Error('sessionId and birthDate required');
    return { externalId: b.sessionId, approved: true, birthDate: b.birthDate };
  }
}

/** Stub for a real vendor. Wire the HTTP calls and HMAC check before enabling in production. */
class VendorStubProvider implements AgeVerificationProvider {
  constructor(readonly name: 'veriff' | 'persona', private readonly apiKey?: string) {}
  async createSession(): Promise<AgeCheckSession> {
    if (!this.apiKey) throw new NotImplementedException(`${this.name} is not configured`);
    // Veriff: POST https://stationapi.veriff.com/v1/sessions ; Persona: POST https://withpersona.com/api/v1/inquiries
    throw new NotImplementedException(`${this.name} integration is a stub in the MVP`);
  }
  async parseWebhook(): Promise<AgeCheckResult> {
    throw new NotImplementedException(`${this.name} webhook is a stub in the MVP`);
  }
}

export function createAgeVerificationProvider(c: AppConfig): AgeVerificationProvider {
  switch (c.AGE_VERIFICATION_PROVIDER) {
    case 'veriff':
      return new VendorStubProvider('veriff', process.env.VERIFF_API_KEY);
    case 'persona':
      return new VendorStubProvider('persona', process.env.PERSONA_API_KEY);
    default:
      if (c.NODE_ENV === 'production') throw new Error('Mock age verification is not allowed in production');
      return new MockAgeVerificationProvider(c.WEB_URL);
  }
}
