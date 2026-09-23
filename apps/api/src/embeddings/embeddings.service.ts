import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EMBEDDING_DIM, EMBEDDING_PROVIDER, EmbeddingProvider } from './embedding.provider';

export function toVectorLiteral(v: number[]): string {
  return `[${v.map((x) => (Number.isFinite(x) ? x.toFixed(6) : '0')).join(',')}]`;
}

@Injectable()
export class EmbeddingsService {
  private readonly log = new Logger(EmbeddingsService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
  ) {}

  /** Text used for semantic search: description + interests. */
  static profileText(p: { aiDescription?: string | null; interestTags?: string[]; interestsText?: string | null }): string {
    return [p.aiDescription ?? '', (p.interestTags ?? []).join(' '), p.interestsText ?? ''].join('\n').trim();
  }

  async embed(text: string): Promise<number[]> {
    const [v] = await this.provider.embed([text]);
    if (v.length !== EMBEDDING_DIM) throw new Error(`Embedding provider returned ${v.length} dims`);
    return v;
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    return this.provider.embed(texts);
  }

  async updateProfileEmbedding(userId: string, text: string): Promise<void> {
    if (!text) {
      await this.prisma.$executeRaw`UPDATE "Profile" SET embedding = NULL WHERE "userId" = ${userId}`;
      return;
    }
    try {
      const v = await this.embed(text);
      await this.writeVector(userId, v);
    } catch (e) {
      this.log.error(`embedding failed for ${userId}: ${(e as Error).message}`);
    }
  }

  async writeVector(userId: string, v: number[]): Promise<void> {
    await this.prisma.$executeRaw`UPDATE "Profile" SET embedding = ${toVectorLiteral(v)}::vector WHERE "userId" = ${userId}`;
  }
}
