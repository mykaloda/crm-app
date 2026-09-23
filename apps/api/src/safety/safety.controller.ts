import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequestUser } from '../common/auth.decorators';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { SafetyService } from './safety.service';

export const REPORT_REASONS = ['fake_profile', 'harassment', 'scam_or_money', 'inappropriate_content', 'underage', 'safety_concern', 'other'] as const;
const reportBody = z.object({ matchId: z.string(), reason: z.enum(REPORT_REASONS), details: z.string().max(2000).optional() });
const blockBody = z.object({ matchId: z.string() });

@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService, private readonly rateLimit: RateLimitService) {}

  @Post('reports')
  async report(@CurrentUser() u: RequestUser, @Body(new ZodPipe(reportBody)) b: z.infer<typeof reportBody>) {
    await this.rateLimit.consume(`report:${u.id}`, 20, 86400, 'reports');
    return this.safety.report(u.id, b.matchId, b.reason, b.details);
  }

  @Post('blocks')
  @HttpCode(200)
  block(@CurrentUser() u: RequestUser, @Body(new ZodPipe(blockBody)) b: z.infer<typeof blockBody>) {
    return this.safety.block(u.id, b.matchId);
  }

  @Get('blocks')
  blocks(@CurrentUser() u: RequestUser) {
    return this.safety.blocks(u.id);
  }
}
