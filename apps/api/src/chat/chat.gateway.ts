import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { APP_CONFIG, AppConfig, loadConfig } from '../config/config';
import { ACCESS_COOKIE } from '../common/auth.decorators';
import { resolveSessionUser } from '../common/auth.guard';
import { PrismaService } from '../common/prisma.service';
import { ChatEvent, ChatService } from './chat.service';

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];
}

@WebSocketGateway({ namespace: '/chat', cors: { origin: loadConfigSafe(), credentials: true } })
export class ChatGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger(ChatGateway.name);
  private readonly onMessage = (e: ChatEvent) => {
    for (const uid of e.recipients) this.server?.to(`user:${uid}`).emit('message:new', e.message);
  };

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    this.chat.events.on('message', this.onMessage);
  }
  onModuleDestroy() {
    this.chat.events.off('message', this.onMessage);
  }

  async handleConnection(socket: Socket) {
    const token =
      (socket.handshake.auth?.token as string | undefined) ?? cookieValue(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const user = await resolveSessionUser(this.jwt, this.prisma, token);
    if (!user) {
      socket.emit('error', { error: 'unauthorized' });
      socket.disconnect(true);
      return;
    }
    socket.data.userId = user.id;
    await socket.join(`user:${user.id}`);
  }

  @SubscribeMessage('message:send')
  async send(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchId?: string; body?: string }) {
    try {
      if (!socket.data.userId || !body?.matchId || !body.body?.trim()) return { ok: false, error: 'invalid' };
      const message = await this.chat.send(socket.data.userId, body.matchId, body.body);
      return { ok: true, message };
    } catch (e) {
      this.log.debug(`send failed: ${(e as Error).message}`);
      return { ok: false, error: (e as Error).message };
    }
  }
}

function loadConfigSafe(): string[] {
  try {
    return [loadConfig().WEB_URL];
  } catch {
    return ['http://localhost:3000'];
  }
}
