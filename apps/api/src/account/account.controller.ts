import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { missingRequired } from '@agentmatch/shared';
import { CurrentUser, RequestUser } from '../common/auth.decorators';
import { ConsentService } from '../common/consent.service';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { ProfileService } from '../profile/profile.service';

const consentBody = z.object({
  terms: z.boolean().optional(),
  privacy: z.boolean().optional(),
  /** Separate, explicit opt-in for GDPR special-category data (faith, politics). */
  sensitiveData: z.boolean().optional(),
  aiProcessing: z.boolean().optional(),
});
const localeBody = z.object({ locale: z.enum(['en', 'ru']) });

const MAP = { terms: 'TERMS', privacy: 'PRIVACY', sensitiveData: 'SENSITIVE_DATA', aiProcessing: 'AI_PROCESSING' } as const;

@Controller('me')
export class AccountController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentService,
    private readonly profiles: ProfileService,
  ) {}

  @Get()
  async me(@CurrentUser() u: RequestUser) {
    const [user, consents, { row, data }, drafts, connections] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: u.id }, include: { subscription: true } }),
      this.consents.active(u.id),
      this.profiles.load(u.id),
      this.prisma.profileDraft.count({ where: { userId: u.id, status: 'PENDING' } }),
      this.prisma.agentConnection.findMany({ where: { userId: u.id, revokedAt: null }, orderBy: { createdAt: 'desc' } }),
    ]);
    const steps = {
      consent: consents.has('TERMS') && consents.has('PRIVACY'),
      verified: user.ageVerificationStatus === 'VERIFIED',
      aiConnected: connections.length > 0,
      profileReady: row?.status === 'ACTIVE' || row?.status === 'PAUSED',
    };
    const nextStep = !steps.consent ? 'consent' : !steps.verified ? 'verify' : !steps.aiConnected ? 'connect' : !steps.profileReady ? 'profile' : 'done';
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      locale: user.locale,
      ageVerificationStatus: user.ageVerificationStatus,
      aiEnabled: user.aiEnabled,
      consents: [...consents],
      profile: { status: row?.status ?? 'INCOMPLETE', completeness: row?.completeness ?? 0, missing: missingRequired(data), displayName: data.basic?.displayName ?? null },
      pendingDrafts: drafts,
      connections: connections.map((c) => ({ id: c.id, type: c.type, label: c.label, lastUsedAt: c.lastUsedAt, createdAt: c.createdAt })),
      subscription: user.subscription?.status === 'active' ? { plan: user.subscription.plan, currentPeriodEnd: user.subscription.currentPeriodEnd } : null,
      onboarding: { ...steps, nextStep },
    };
  }

  @Post('consents')
  @HttpCode(200)
  async setConsents(@CurrentUser() u: RequestUser, @Body(new ZodPipe(consentBody)) body: z.infer<typeof consentBody>) {
    for (const [key, type] of Object.entries(MAP) as [keyof typeof MAP, (typeof MAP)[keyof typeof MAP]][]) {
      const v = body[key];
      if (v === true) await this.consents.grant(u.id, type);
      if (v === false) {
        await this.consents.revoke(u.id, type);
        if (type === 'SENSITIVE_DATA') await this.profiles.purgeSensitive(u.id);
      }
    }
    return { consents: [...(await this.consents.active(u.id))] };
  }

  @Put('locale')
  async locale(@CurrentUser() u: RequestUser, @Body(new ZodPipe(localeBody)) body: z.infer<typeof localeBody>) {
    await this.prisma.user.update({ where: { id: u.id }, data: { locale: body.locale } });
    return { locale: body.locale };
  }
}
