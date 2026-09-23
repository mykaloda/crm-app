import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AlgorithmConfig, DEFAULT_ALGORITHM_CONFIG, algorithmConfigSchema } from '@agentmatch/shared';
import { PrismaService } from '../common/prisma.service';

/** Matching weights and limits, editable from the admin panel. Cached briefly. */
@Injectable()
export class AlgorithmConfigService {
  private cache?: { value: AlgorithmConfig; at: number };
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<AlgorithmConfig> {
    if (this.cache && Date.now() - this.cache.at < 30_000) return this.cache.value;
    const row = await this.prisma.algorithmConfig.findUnique({ where: { id: 'default' } });
    const parsed = algorithmConfigSchema.safeParse({ ...DEFAULT_ALGORITHM_CONFIG, ...((row?.config as object) ?? {}) });
    const value = parsed.success ? parsed.data : DEFAULT_ALGORITHM_CONFIG;
    this.cache = { value, at: Date.now() };
    return value;
  }

  async update(patch: Partial<AlgorithmConfig>, adminId: string): Promise<AlgorithmConfig> {
    const next = algorithmConfigSchema.parse({ ...(await this.get()), ...patch });
    await this.prisma.algorithmConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', config: next as unknown as Prisma.InputJsonValue, updatedBy: adminId },
      update: { config: next as unknown as Prisma.InputJsonValue, updatedBy: adminId },
    });
    this.cache = undefined;
    return next;
  }
}
