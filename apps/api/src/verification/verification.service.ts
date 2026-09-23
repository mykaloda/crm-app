import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ageFromBirthDate } from '@agentmatch/shared';
import { PrismaService } from '../common/prisma.service';
import { AGE_VERIFICATION_PROVIDER, AgeCheckResult, AgeVerificationProvider } from './age-verification.provider';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AGE_VERIFICATION_PROVIDER) readonly provider: AgeVerificationProvider,
  ) {}

  async start(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.ageVerificationStatus === 'VERIFIED') return { status: 'VERIFIED' as const };
    const s = await this.provider.createSession(userId);
    await this.prisma.$transaction([
      this.prisma.ageVerification.create({ data: { userId, provider: this.provider.name, externalId: s.externalId } }),
      this.prisma.user.update({ where: { id: userId }, data: { ageVerificationStatus: 'PENDING' } }),
    ]);
    return { status: 'PENDING' as const, redirectUrl: s.redirectUrl, sessionId: s.externalId };
  }

  /** Apply a vendor result. Approval requires the vendor to confirm the person is 18+. */
  async complete(result: AgeCheckResult, expectUserId?: string) {
    const v = await this.prisma.ageVerification.findUnique({ where: { externalId: result.externalId } });
    if (!v || (expectUserId && v.userId !== expectUserId)) throw new NotFoundException('Verification session not found');
    if (v.status !== 'PENDING') throw new BadRequestException('Verification already completed');
    const adult = !!result.birthDate && ageFromBirthDate(result.birthDate) >= 18;
    const status = result.approved && adult ? 'VERIFIED' : 'REJECTED';
    await this.prisma.$transaction([
      this.prisma.ageVerification.update({
        where: { externalId: result.externalId },
        data: { status, completedAt: new Date(), result: { approved: result.approved, adult, reason: result.reason ?? null } },
      }),
      this.prisma.user.update({
        where: { id: v.userId },
        data: { ageVerificationStatus: status, ageVerifiedAt: status === 'VERIFIED' ? new Date() : null },
      }),
    ]);
    return { status };
  }
}
