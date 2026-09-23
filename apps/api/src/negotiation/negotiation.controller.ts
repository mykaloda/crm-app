import { Controller, Get } from '@nestjs/common';
import { CurrentUser, RequestUser } from '../common/auth.decorators';
import { NegotiationService } from './negotiation.service';

@Controller('negotiations')
export class NegotiationController {
  constructor(private readonly negotiations: NegotiationService) {}

  /** Journal of everything the user's agent negotiated. */
  @Get()
  journal(@CurrentUser() user: RequestUser) {
    return this.negotiations.journal(user.id);
  }
}
