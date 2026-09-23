import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/** Records one activity row per user per day (for D30 retention) and lastActiveAt. */
@Injectable()
export class ActivityService {
  private readonly log = new Logger(ActivityService.name);
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async touch(userId: string, now = new Date()): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    try {
      const fresh = await this.redis.client.set(`act:${userId}:${day}`, '1', 'EX', 90000, 'NX');
      if (!fresh) return;
      await this.prisma.$transaction([
        this.prisma.userActivityDay.upsert({
          where: { userId_day: { userId, day: new Date(`${day}T00:00:00Z`) } },
          create: { userId, day: new Date(`${day}T00:00:00Z`) },
          update: {},
        }),
        this.prisma.user.update({ where: { id: userId }, data: { lastActiveAt: now } }),
      ]);
    } catch (e) {
      this.log.warn(`activity touch failed: ${(e as Error).message}`);
    }
  }
}
