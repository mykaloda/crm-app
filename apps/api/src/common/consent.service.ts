import { Injectable } from '@nestjs/common';
import { ConsentType } from '@prisma/client';
import { PrismaService } from './prisma.service';

export const CONSENT_VERSION = '2026-09';

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  async active(userId: string): Promise<Set<ConsentType>> {
    const rows = await this.prisma.consent.findMany({ where: { userId, revokedAt: null }, select: { type: true } });
    return new Set(rows.map((r) => r.type));
  }

  async has(userId: string, type: ConsentType): Promise<boolean> {
    return (await this.prisma.consent.count({ where: { userId, type, revokedAt: null } })) > 0;
  }

  async grant(userId: string, type: ConsentType): Promise<void> {
    if (await this.has(userId, type)) return;
    await this.prisma.consent.create({ data: { userId, type, version: CONSENT_VERSION } });
  }

  async revoke(userId: string, type: ConsentType): Promise<void> {
    await this.prisma.consent.updateMany({ where: { userId, type, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
