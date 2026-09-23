import { Controller, HttpCode, Post } from '@nestjs/common';
import { CurrentUser, RequestUser, RequireAgeVerified } from '../common/auth.decorators';
import { RateLimitService } from '../common/rate-limit.service';
import { MatchingScheduler } from './matching.queue';

@Controller('matching')
export class MatchingController {
  constructor(private readonly scheduler: MatchingScheduler, private readonly rateLimit: RateLimitService) {}

  /** "Find matches now": queues a run for the current user. */
  @RequireAgeVerified()
  @Post('run')
  @HttpCode(202)
  async run(@CurrentUser() user: RequestUser) {
    await this.rateLimit.consume(`run:${user.id}`, 5, 86400, 'manual matching runs');
    await this.scheduler.enqueueUser(user.id);
    return { queued: true };
  }
}
