import { Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, RequestUser } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { PAYMENTS_PROVIDER, PaymentEvent, PaymentsProvider } from './payments.provider';

const mockBody = z.object({ sessionId: z.string() });

@Controller('billing')
export class BillingController {
  constructor(private readonly prisma: PrismaService, @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider) {}

  @Get('subscription')
  async subscription(@CurrentUser() u: RequestUser) {
    return (await this.prisma.subscription.findUnique({ where: { userId: u.id } })) ?? { status: 'none' };
  }

  @Post('checkout')
  @HttpCode(200)
  checkout(@CurrentUser() u: RequestUser) {
    return this.payments.createCheckout(u.id);
  }

  /** Development only: the mock checkout page confirms payment here. */
  @Post('mock/complete')
  @HttpCode(200)
  async mockComplete(@CurrentUser() u: RequestUser, @Body(new ZodPipe(mockBody)) b: z.infer<typeof mockBody>) {
    if (this.payments.name !== 'mock') throw new NotFoundException();
    const event = await this.payments.parseWebhook({}, { userId: u.id, sessionId: b.sessionId });
    return this.apply(event!);
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Headers() headers: Record<string, string>, @Body() body: unknown) {
    if (this.payments.name === 'mock') throw new NotFoundException();
    const event = await this.payments.parseWebhook(headers, body);
    return event ? this.apply(event) : { ignored: true };
  }

  @Post('cancel')
  @HttpCode(200)
  async cancel(@CurrentUser() u: RequestUser) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId: u.id } });
    if (!sub) throw new NotFoundException();
    if (sub.externalId) await this.payments.cancel(sub.externalId);
    return this.prisma.subscription.update({ where: { userId: u.id }, data: { status: 'canceled' } });
  }

  private apply(e: PaymentEvent) {
    return this.prisma.subscription.upsert({
      where: { userId: e.userId },
      create: { userId: e.userId, provider: this.payments.name, externalId: e.externalId, status: e.status, currentPeriodEnd: e.currentPeriodEnd },
      update: { externalId: e.externalId, status: e.status, currentPeriodEnd: e.currentPeriodEnd },
    });
  }
}
