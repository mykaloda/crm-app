import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { algorithmConfigSchema } from '@agentmatch/shared';
import { CurrentUser, RequestUser, Roles } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';
import { AlgorithmConfigService } from '../matching/algorithm-config.service';
import { OAuthService } from '../oauth/oauth.service';
import { MetricsService } from './metrics.service';

const statusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED']), note: z.string().max(500).optional() });
const resolveBody = z.object({ action: z.enum(['dismiss', 'warn', 'suspend', 'ban']), note: z.string().max(1000).optional() });
const photoBody = z.object({ moderation: z.enum(['APPROVED', 'REJECTED']) });
const algorithmBody = algorithmConfigSchema.partial();

@Roles('ADMIN', 'MODERATOR')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly algorithm: AlgorithmConfigService,
    private readonly metrics: MetricsService,
    private readonly oauth: OAuthService,
  ) {}

  @Get('users')
  async users(@Query('q') q?: string, @Query('status') status?: string, @Query('page') page = '1') {
    const where: Prisma.UserWhereInput = {
      ...(q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { profile: { displayName: { contains: q, mode: 'insensitive' } } }] } : {}),
      ...(status ? { status: status as never } : {}),
    };
    const take = 50;
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: { profile: { select: { displayName: true, status: true, completeness: true, city: true } }, _count: { select: { reportsReceived: true } } },
      }),
    ]);
    return {
      total,
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        status: u.status,
        ageVerification: u.ageVerificationStatus,
        aiEnabled: u.aiEnabled,
        profile: u.profile,
        reports: u._count.reportsReceived,
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt,
      })),
    };
  }

  @Post('users/:id/status')
  @HttpCode(200)
  async setStatus(@CurrentUser() admin: RequestUser, @Param('id') id: string, @Body(new ZodPipe(statusBody)) b: z.infer<typeof statusBody>) {
    return this.applyStatus(id, b.status);
  }

  private async applyStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED' | 'BANNED') {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { status } });
    if (status !== 'ACTIVE') {
      await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.oauth.revokeAllForUser(userId);
      await this.prisma.profile.updateMany({ where: { userId, status: 'ACTIVE' }, data: { status: 'PAUSED' } });
    }
    return { id: user.id, status: user.status };
  }

  @Get('reports')
  async reports(@Query('status') status = 'OPEN') {
    const rows = await this.prisma.report.findMany({
      where: { status: status as never },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        target: { select: { id: true, email: true, status: true, profile: { select: { displayName: true, aiDescription: true } } } },
        reporter: { select: { id: true, email: true } },
      },
    });
    const out = [];
    for (const r of rows) {
      const chat = r.matchId
        ? await this.prisma.chatMessage.findMany({ where: { matchId: r.matchId }, orderBy: { createdAt: 'desc' }, take: 30 })
        : [];
      out.push({ ...r, recentChat: chat.reverse() });
    }
    return out;
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  async resolve(@CurrentUser() mod: RequestUser, @Param('id') id: string, @Body(new ZodPipe(resolveBody)) b: z.infer<typeof resolveBody>) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException();
    if (b.action === 'suspend') await this.applyStatus(report.targetUserId, 'SUSPENDED');
    if (b.action === 'ban') await this.applyStatus(report.targetUserId, 'BANNED');
    return this.prisma.report.update({
      where: { id },
      data: {
        status: b.action === 'dismiss' ? 'DISMISSED' : 'RESOLVED',
        resolution: `${b.action}${b.note ? `: ${b.note}` : ''}`,
        moderatorId: mod.id,
        resolvedAt: new Date(),
      },
    });
  }

  @Get('photos')
  photos(@Query('moderation') moderation = 'APPROVED') {
    return this.prisma.photo.findMany({
      where: { moderation: moderation as never },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, userId: true, moderation: true, createdAt: true },
    });
  }

  @Post('photos/:id')
  @HttpCode(200)
  moderatePhoto(@Param('id') id: string, @Body(new ZodPipe(photoBody)) b: z.infer<typeof photoBody>) {
    return this.prisma.photo.update({ where: { id }, data: { moderation: b.moderation }, select: { id: true, moderation: true } });
  }

  @Roles('ADMIN')
  @Get('algorithm')
  getAlgorithm() {
    return this.algorithm.get();
  }

  @Roles('ADMIN')
  @Put('algorithm')
  updateAlgorithm(@CurrentUser() admin: RequestUser, @Body(new ZodPipe(algorithmBody)) b: z.infer<typeof algorithmBody>) {
    return this.algorithm.update(b, admin.id);
  }

  @Roles('ADMIN')
  @Get('metrics')
  getMetrics() {
    return this.metrics.compute();
  }
}
