import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { buildAgentOpenApi } from '@agentmatch/shared';
import { APP_CONFIG, AppConfig } from '../config/config';
import { CurrentUser, Public, RequestUser } from '../common/auth.decorators';
import { PrismaService } from '../common/prisma.service';
import { AgentContext } from './agent-context';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentToolsService } from './agent-tools.service';

@Controller()
export class AgentToolsController {
  constructor(
    private readonly tools: AgentToolsService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** OpenAPI spec for Custom GPT Actions. */
  @Public()
  @Get('agent/v1/openapi.json')
  openapi() {
    return buildAgentOpenApi(this.config.API_URL);
  }

  /** Tool endpoint used by the MCP server and Custom GPT. */
  @Public()
  @UseGuards(AgentAuthGuard)
  @Post('agent/v1/tools/:tool')
  @HttpCode(200)
  call(@Req() req: Request & { agent: AgentContext }, @Param('tool') tool: string, @Body() body: unknown) {
    return this.tools.execute(req.agent, tool, body);
  }

  /** Owner-visible log of everything their agents did. */
  @Get('agent/log')
  async log(@CurrentUser() user: RequestUser, @Query('limit') limit?: string, @Query('before') before?: string) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const rows = await this.prisma.agentActionLog.findMany({
      where: { userId: user.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take,
      include: { connection: { select: { label: true, type: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      tool: r.tool,
      status: r.status,
      reason: r.reason,
      input: r.input,
      resultSummary: r.resultSummary,
      agent: r.connection ? `${r.connection.label} (${r.connection.type})` : 'system',
      createdAt: r.createdAt,
    }));
  }
}
