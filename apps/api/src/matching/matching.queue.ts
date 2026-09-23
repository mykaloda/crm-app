import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/config';
import { PrismaService } from '../common/prisma.service';
import { MatchingService } from './matching.service';

export const MATCHING_QUEUE = 'matching';

/** Hook for the negotiation module: called with new candidate match ids after each run. */
export const AFTER_MATCHING = Symbol('AFTER_MATCHING');
export type AfterMatchingHook = (userId: string, matchIds: string[]) => Promise<void>;

@Injectable()
export class MatchingScheduler implements OnModuleInit {
  private readonly log = new Logger(MatchingScheduler.name);
  constructor(
    @InjectQueue(MATCHING_QUEUE) private readonly queue: Queue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onModuleInit() {
    if (!this.config.MATCHING_ENABLE_SCHEDULER) return;
    await this.queue.upsertJobScheduler('daily-matching', { pattern: this.config.MATCHING_DAILY_CRON }, { name: 'daily' });
    this.log.log(`Daily matching scheduled: ${this.config.MATCHING_DAILY_CRON}`);
  }

  /** On-demand run for one user (deduplicated per 10 minutes). */
  async enqueueUser(userId: string) {
    const slot = Math.floor(Date.now() / 600_000);
    await this.queue.add('user', { userId }, { jobId: `user-${userId}-${slot}`, removeOnComplete: 1000, removeOnFail: 1000 });
  }
}

@Processor(MATCHING_QUEUE, { concurrency: 4 })
export class MatchingProcessor extends WorkerHost {
  private readonly log = new Logger(MatchingProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    @InjectQueue(MATCHING_QUEUE) private readonly queue: Queue,
    @Inject(AFTER_MATCHING) private readonly afterMatching: AfterMatchingHook,
  ) {
    super();
  }

  async process(job: Job<{ userId?: string }>): Promise<unknown> {
    if (job.name === 'daily') {
      const users = await this.prisma.user.findMany({
        where: { status: 'ACTIVE', aiEnabled: true, ageVerificationStatus: 'VERIFIED', profile: { status: 'ACTIVE' } },
        select: { id: true },
      });
      const day = new Date().toISOString().slice(0, 10);
      await this.queue.addBulk(
        users.map((u) => ({ name: 'user', data: { userId: u.id }, opts: { jobId: `daily-${day}-${u.id}`, removeOnComplete: 1000, removeOnFail: 1000 } })),
      );
      return { enqueued: users.length };
    }
    if (job.name === 'user' && job.data.userId) {
      const matches = await this.matching.runForUser(job.data.userId);
      await this.afterMatching(job.data.userId, matches.map((m) => m.id));
      return { candidates: matches.length };
    }
    this.log.warn(`Unknown job ${job.name}`);
    return null;
  }
}
