import { NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from '../config/config';

export interface CheckoutSession {
  sessionId: string;
  url: string;
}

export interface PaymentEvent {
  userId: string;
  status: 'active' | 'canceled' | 'past_due';
  externalId: string;
  currentPeriodEnd: Date;
}

/** Subscription payments. Stripe in production; mock in development. */
export interface PaymentsProvider {
  readonly name: string;
  createCheckout(userId: string): Promise<CheckoutSession>;
  parseWebhook(headers: Record<string, string | string[] | undefined>, rawBody: unknown): Promise<PaymentEvent | null>;
  cancel(externalId: string): Promise<void>;
}

export const PAYMENTS_PROVIDER = Symbol('PAYMENTS_PROVIDER');

export class MockPaymentsProvider implements PaymentsProvider {
  readonly name = 'mock';
  constructor(private readonly webUrl: string) {}
  async createCheckout(userId: string) {
    const sessionId = `mock_cs_${randomUUID()}`;
    return { sessionId, url: `${this.webUrl}/billing/mock?session=${sessionId}&user=${userId}` };
  }
  async parseWebhook(_h: Record<string, unknown>, body: unknown) {
    const b = body as { userId?: string; sessionId?: string };
    if (!b.userId || !b.sessionId) return null;
    return { userId: b.userId, status: 'active' as const, externalId: b.sessionId, currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) };
  }
  async cancel() {}
}

/**
 * Stripe stub: Checkout Session (mode=subscription, price STRIPE_PRICE_ID, client_reference_id=userId)
 * and webhook events checkout.session.completed / customer.subscription.updated|deleted,
 * verified with STRIPE_WEBHOOK_SECRET. Not wired in the MVP.
 */
export class StripePaymentsProvider implements PaymentsProvider {
  readonly name = 'stripe';
  async createCheckout(): Promise<CheckoutSession> {
    throw new NotImplementedException('Stripe checkout is a stub in the MVP');
  }
  async parseWebhook(): Promise<PaymentEvent | null> {
    throw new NotImplementedException('Stripe webhooks are a stub in the MVP');
  }
  async cancel() {
    throw new NotImplementedException('Stripe is a stub in the MVP');
  }
}

export function createPaymentsProvider(c: AppConfig): PaymentsProvider {
  if (c.PAYMENTS_PROVIDER === 'stripe') return new StripePaymentsProvider();
  if (c.NODE_ENV === 'production') throw new Error('Mock payments are not allowed in production');
  return new MockPaymentsProvider(c.WEB_URL);
}
