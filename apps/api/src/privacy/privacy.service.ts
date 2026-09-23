import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { OAuthService } from '../oauth/oauth.service';
import { PHOTO_STORAGE, PhotoStorage } from '../profile/photo-storage';
import { ProfileService } from '../profile/profile.service';

@Injectable()
export class PrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly oauth: OAuthService,
    private readonly profiles: ProfileService,
    @Inject(PHOTO_STORAGE) private readonly storage: PhotoStorage,
  ) {}

  /**
   * One-click AI switch. Off: every external token and connection is revoked, the
   * built-in agent stops, and the user leaves matching until switched back on.
   */
  async setAi(userId: string, enabled: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { aiEnabled: enabled } });
    if (!enabled) await this.oauth.revokeAllForUser(userId);
    return { aiEnabled: enabled };
  }

  /** GDPR Art. 15/20: everything we hold about the user, decrypted, machine-readable. */
  async export(userId: string) {
    const [user, profile, drafts, photos, consents, connections, logs, matches, sentAgentMessages, chat, feedback, reports, blocks, subscription, interviews] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { identities: { select: { provider: true, createdAt: true } } } }),
        this.profiles.getView(userId),
        this.prisma.profileDraft.findMany({ where: { userId } }),
        this.prisma.photo.findMany({ where: { userId }, select: { id: true, position: true, createdAt: true, moderation: true } }),
        this.prisma.consent.findMany({ where: { userId } }),
        this.prisma.agentConnection.findMany({ where: { userId } }),
        this.prisma.agentActionLog.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        this.prisma.match.findMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] }, include: { negotiation: true } }),
        this.prisma.agentMessage.findMany({ where: { fromUserId: userId } }),
        this.prisma.chatMessage.findMany({ where: { senderId: userId } }),
        this.prisma.matchFeedback.findMany({ where: { userId } }),
        this.prisma.report.findMany({ where: { reporterId: userId }, select: { reason: true, details: true, createdAt: true, status: true } }),
        this.prisma.block.findMany({ where: { blockerId: userId }, select: { createdAt: true } }),
        this.prisma.subscription.findUnique({ where: { userId } }),
        this.prisma.interviewSession.findMany({ where: { userId } }),
      ]);
    const { passwordHash: _pw, ...account } = user;
    return {
      exportedAt: new Date().toISOString(),
      account,
      profile,
      drafts: drafts.map((d) => ({ id: d.id, source: d.source, status: d.status, createdAt: d.createdAt, patch: this.crypto.decryptJson(d.patchEnc) })),
      photos,
      consents,
      aiConnections: connections,
      agentActionLog: logs,
      matches: matches.map((m) => {
        const side = m.userAId === userId ? 'A' : 'B';
        return {
          id: m.id,
          status: m.status,
          score: m.score,
          yourDecision: side === 'A' ? m.decisionA : m.decisionB,
          explanation: side === 'A' ? m.explanationA : m.explanationB,
          yourAgentVerdict: side === 'A' ? m.negotiation?.verdictA : m.negotiation?.verdictB,
          createdAt: m.createdAt,
        };
      }),
      agentMessagesSent: sentAgentMessages,
      chatMessagesSent: chat,
      feedback,
      reportsFiled: reports,
      blocks,
      subscription,
      interviews,
    };
  }

  /** GDPR Art. 17: delete the account and everything linked to it. */
  async deleteAccount(userId: string, confirmEmail: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== confirmEmail.trim().toLowerCase()) throw new BadRequestException('Type your email to confirm');
    const photos = await this.prisma.photo.findMany({ where: { userId } });
    await this.oauth.revokeAllForUser(userId);
    // Pairs are cascaded through Match; reports against the user go too (their content is personal data).
    await this.prisma.user.delete({ where: { id: userId } });
    for (const p of photos) await this.storage.delete(p.storageKey);
    return { deleted: true };
  }
}
