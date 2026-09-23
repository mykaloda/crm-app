import { Injectable, NotImplementedException } from '@nestjs/common';

/** Placeholder until the matching module lands (stage 3). */
@Injectable()
export class MatchingService {
  async searchForAgent(_userId: string, _limit: number): Promise<unknown> {
    throw new NotImplementedException('search_candidates arrives with the matching module');
  }
  async candidateCard(_userId: string, _candidateId: string): Promise<unknown> {
    throw new NotImplementedException('get_candidate_card arrives with the matching module');
  }
  async listMatchesForAgent(_userId: string, _status: string): Promise<unknown> {
    return { matches: [] };
  }
}
