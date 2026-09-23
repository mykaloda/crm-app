import { Body, Controller, Headers, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, Public, RequestUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { VerificationService } from './verification.service';

const mockBody = z.object({ sessionId: z.string(), birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

@Controller('verification/age')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('start')
  @HttpCode(200)
  start(@CurrentUser() user: RequestUser) {
    return this.verification.start(user.id);
  }

  /** Development only: the mock vendor page posts its result here. */
  @Post('mock/complete')
  @HttpCode(200)
  async mockComplete(@CurrentUser() user: RequestUser, @Body(new ZodPipe(mockBody)) body: z.infer<typeof mockBody>) {
    if (this.verification.provider.name !== 'mock') throw new NotFoundException();
    const result = await this.verification.provider.parseWebhook({}, body);
    return this.verification.complete(result, user.id);
  }

  @Public()
  @Post('webhook/:provider')
  @HttpCode(200)
  async webhook(@Param('provider') provider: string, @Headers() headers: Record<string, string>, @Body() body: unknown) {
    if (provider !== this.verification.provider.name || provider === 'mock') throw new NotFoundException();
    const result = await this.verification.provider.parseWebhook(headers, body);
    return this.verification.complete(result);
  }
}
