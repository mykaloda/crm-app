import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth.decorators';
import { PrismaService } from './common/prisma.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
