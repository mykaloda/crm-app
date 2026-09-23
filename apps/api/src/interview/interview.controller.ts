import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequestUser, RequireAgeVerified } from '../common/auth.decorators';
import { RateLimitService } from '../common/rate-limit.service';
import { ZodPipe } from '../common/zod.pipe';
import { InterviewService } from './interview.service';

const messageBody = z.object({ content: z.string().trim().min(1).max(4000) });

@RequireAgeVerified()
@Controller('interview')
export class InterviewController {
  constructor(private readonly interviews: InterviewService, private readonly rateLimit: RateLimitService) {}

  @Get()
  current(@CurrentUser() u: RequestUser) {
    return this.interviews.current(u.id);
  }

  @Post('start')
  @HttpCode(200)
  start(@CurrentUser() u: RequestUser) {
    return this.interviews.start(u.id);
  }

  @Post(':id/message')
  @HttpCode(200)
  async message(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(messageBody)) body: z.infer<typeof messageBody>) {
    await this.rateLimit.consume(`interview:${u.id}`, 120, 3600, 'interview messages');
    return this.interviews.message(u.id, id, body.content);
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.interviews.finish(u.id, id);
  }
}
