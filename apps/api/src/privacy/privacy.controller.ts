import { Body, Controller, Delete, Get, HttpCode, Post, Put, Res } from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { AuthService } from '../auth/auth.service';
import { CurrentUser, RequestUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ProfileService } from '../profile/profile.service';
import { PrivacyService } from './privacy.service';

const aiBody = z.object({ enabled: z.boolean() });
const deleteBody = z.object({ confirmEmail: z.string() });

@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService, private readonly profiles: ProfileService, private readonly auth: AuthService) {}

  @Put('ai')
  ai(@CurrentUser() u: RequestUser, @Body(new ZodPipe(aiBody)) b: z.infer<typeof aiBody>) {
    return this.privacy.setAi(u.id, b.enabled);
  }

  @Post('pause')
  @HttpCode(200)
  pause(@CurrentUser() u: RequestUser, @Body() b: { paused?: boolean }) {
    return this.profiles.setPaused(u.id, b.paused !== false);
  }

  @Get('export')
  async export(@CurrentUser() u: RequestUser, @Res() res: Response) {
    const data = await this.privacy.export(u.id);
    res.setHeader('Content-Disposition', `attachment; filename="agentmatch-export-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.json(data);
  }

  @Delete('account')
  async remove(@CurrentUser() u: RequestUser, @Body(new ZodPipe(deleteBody)) b: z.infer<typeof deleteBody>, @Res({ passthrough: true }) res: Response) {
    const r = await this.privacy.deleteAccount(u.id, b.confirmEmail);
    this.auth.clearCookies(res);
    return r;
  }
}
