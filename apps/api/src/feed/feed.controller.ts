import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequestUser, RequireAgeVerified } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DISCLOSABLE, FeedService } from './feed.service';

const decisionBody = z.object({ decision: z.enum(['LIKE', 'PASS']), disclose: z.array(z.enum(DISCLOSABLE)).default([]) });
const feedbackBody = z.object({ met: z.boolean().optional(), rating: z.number().int().min(1).max(5).optional(), comment: z.string().max(2000).optional() });

@RequireAgeVerified()
@Controller('matches')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('today')
  today(@CurrentUser() u: RequestUser) {
    return this.feed.today(u.id);
  }

  @Get('mutual')
  mutual(@CurrentUser() u: RequestUser) {
    return this.feed.mutual(u.id);
  }

  @Post(':id/decision')
  @HttpCode(200)
  decide(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(decisionBody)) b: z.infer<typeof decisionBody>) {
    return this.feed.decide(u.id, id, b.decision, b.disclose);
  }

  @Post(':id/unmatch')
  @HttpCode(200)
  unmatch(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.feed.unmatch(u.id, id);
  }

  @Post(':id/feedback')
  feedback(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(feedbackBody)) b: z.infer<typeof feedbackBody>) {
    return this.feed.feedback(u.id, id, b);
  }
}
