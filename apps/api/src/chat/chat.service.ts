import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ChatMessage } from '@prisma/client';
import { EventEmitter } from 'node:events';
import { PrismaService } from '../common/prisma.service';
import { RateLimitService } from '../common/rate-limit.service';
import { sideOf } from '../matching/matching.service';

export interface ChatEvent {
  recipients: string[];
  message: ChatMessage;
}

/** Human-to-human chat, available only for mutual matches that are not blocked. */
@Injectable()
export class ChatService {
  /** The Socket.IO gateway subscribes to this to push messages in real time. */
  readonly events = new EventEmitter();

  constructor(private readonly prisma: PrismaService, private readonly rateLimit: RateLimitService) {}

  async assertChat(userId: string, matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId } });
    if (!match) throw new NotFoundException();
    const side = sideOf(match, userId);
    const otherId = side === 'A' ? match.userBId : match.userAId;
    if (match.status !== 'MUTUAL') throw new ForbiddenException('Chat opens after a mutual like');
    const blocked = await this.prisma.block.count({
      where: { OR: [{ blockerId: userId, blockedId: otherId }, { blockerId: otherId, blockedId: userId }] },
    });
    if (blocked) throw new ForbiddenException('Chat unavailable');
    return { match, otherId };
  }

  async list(userId: string) {
    const matches = await this.prisma.match.findMany({
      where: { status: 'MUTUAL', OR: [{ userAId: userId }, { userBId: userId }] },
      orderBy: { updatedAt: 'desc' },
    });
    const out = [];
    for (const m of matches) {
      const otherId = m.userAId === userId ? m.userBId : m.userAId;
      const [last, unread, disclosure] = await Promise.all([
        this.prisma.chatMessage.findFirst({ where: { matchId: m.id }, orderBy: { createdAt: 'desc' } }),
        this.prisma.chatMessage.count({ where: { matchId: m.id, senderId: otherId, readAt: null } }),
        this.prisma.disclosure.findFirst({ where: { matchId: m.id, fromUserId: otherId, toUserId: userId } }),
      ]);
      const name = disclosure?.fields.includes('displayName')
        ? (await this.prisma.profile.findUnique({ where: { userId: otherId }, select: { displayName: true } }))?.displayName
        : null;
      out.push({ matchId: m.id, title: name ?? `Match ${m.id.slice(-5).toUpperCase()}`, lastMessage: last, unread });
    }
    return out;
  }

  async messages(userId: string, matchId: string, before?: string) {
    await this.assertChat(userId, matchId);
    const rows = await this.prisma.chatMessage.findMany({
      where: { matchId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.reverse().map((m) => ({ ...m, mine: m.senderId === userId }));
  }

  async send(userId: string, matchId: string, body: string) {
    const { otherId } = await this.assertChat(userId, matchId);
    await this.rateLimit.consume(`chat:${userId}`, 60, 60, 'chat messages');
    const message = await this.prisma.chatMessage.create({ data: { matchId, senderId: userId, body: body.trim().slice(0, 2000) } });
    await this.prisma.match.update({ where: { id: matchId }, data: { updatedAt: new Date() } });
    this.events.emit('message', { recipients: [userId, otherId], message } satisfies ChatEvent);
    return message;
  }

  async markRead(userId: string, matchId: string) {
    const { otherId } = await this.assertChat(userId, matchId);
    const r = await this.prisma.chatMessage.updateMany({ where: { matchId, senderId: otherId, readAt: null }, data: { readAt: new Date() } });
    return { read: r.count };
  }
}
