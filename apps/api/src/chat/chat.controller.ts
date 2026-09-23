import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, RequestUser } from '../common/auth.decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ChatService } from './chat.service';

const sendBody = z.object({ body: z.string().trim().min(1).max(2000) });

@Controller('chats')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get()
  list(@CurrentUser() u: RequestUser) {
    return this.chat.list(u.id);
  }

  @Get(':matchId/messages')
  messages(@CurrentUser() u: RequestUser, @Param('matchId') id: string, @Query('before') before?: string) {
    return this.chat.messages(u.id, id, before);
  }

  @Post(':matchId/messages')
  send(@CurrentUser() u: RequestUser, @Param('matchId') id: string, @Body(new ZodPipe(sendBody)) b: z.infer<typeof sendBody>) {
    return this.chat.send(u.id, id, b.body);
  }

  @Post(':matchId/read')
  @HttpCode(200)
  read(@CurrentUser() u: RequestUser, @Param('matchId') id: string) {
    return this.chat.markRead(u.id, id);
  }
}
