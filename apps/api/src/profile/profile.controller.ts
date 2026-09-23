import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { z } from 'zod';
import { FIELD_DEFS, PHOTOS_FIELD, SECTION_KEYS, VISIBILITY_LEVELS, profileDataSchema, visibilitySchema } from '@agentmatch/shared';
import { CurrentUser, RequestUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PhotosService } from './photos.service';
import { ProfileService } from './profile.service';

const approveBody = z.object({ patch: profileDataSchema.optional() });
const visibilityBody = z.record(z.string(), visibilitySchema);
const pauseBody = z.object({ paused: z.boolean() });

@Controller()
export class ProfileController {
  constructor(private readonly profiles: ProfileService, private readonly photos: PhotosService) {}

  @Get('profile/schema')
  schema() {
    return { sections: SECTION_KEYS, fields: FIELD_DEFS, visibilityLevels: VISIBILITY_LEVELS, photos: PHOTOS_FIELD };
  }

  @Get('profile')
  get(@CurrentUser() user: RequestUser) {
    return this.profiles.getView(user.id);
  }

  /** Direct edit by the human: applied immediately. */
  @Put('profile')
  update(@CurrentUser() user: RequestUser, @Body(new ZodPipe(profileDataSchema)) patch: z.infer<typeof profileDataSchema>) {
    return this.profiles.applyChanges(user.id, patch);
  }

  @Put('profile/visibility')
  visibility(@CurrentUser() user: RequestUser, @Body(new ZodPipe(visibilityBody)) body: z.infer<typeof visibilityBody>) {
    return this.profiles.setVisibility(user.id, body);
  }

  @Post('profile/drafts/:id/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body(new ZodPipe(approveBody)) body: z.infer<typeof approveBody>) {
    return this.profiles.approveDraft(user.id, id, body.patch);
  }

  @Post('profile/drafts/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.profiles.rejectDraft(user.id, id);
  }

  @Post('profile/pause')
  @HttpCode(200)
  pause(@CurrentUser() user: RequestUser, @Body(new ZodPipe(pauseBody)) body: z.infer<typeof pauseBody>) {
    return this.profiles.setPaused(user.id, body.paused);
  }

  @Post('profile/photos')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@CurrentUser() user: RequestUser, @UploadedFile() file: { buffer: Buffer; size: number } | undefined) {
    return this.photos.upload(user.id, file);
  }

  @Delete('profile/photos/:id')
  removePhoto(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.photos.remove(user.id, id);
  }

  @Get('photos/:id')
  async photo(@CurrentUser() user: RequestUser, @Param('id') id: string, @Res() res: Response) {
    const p = await this.photos.read(user.id, id, user.role !== 'USER');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.type(p.mimeType).send(p.data);
  }
}
