import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

export class RateLimitedError extends HttpException {
  constructor(public readonly retryAfterSec: number, what: string) {
    super({ statusCode: 429, error: 'rate_limited', message: `Rate limit exceeded for ${what}`, retryAfterSec }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

/** Fixed-window counter in Redis. */
@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  async hit(bucket: string, limit: number, windowSec: number): Promise<{ allowed: boolean; remaining: number; resetSec: number }> {
    const window = Math.floor(Date.now() / 1000 / windowSec);
    const key = `rl:${bucket}:${window}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, windowSec);
    const resetSec = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetSec };
  }

  async consume(bucket: string, limit: number, windowSec: number, what = bucket): Promise<void> {
    const r = await this.hit(bucket, limit, windowSec);
    if (!r.allowed) throw new RateLimitedError(r.resetSec, what);
  }
}
