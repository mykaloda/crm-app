import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Role } from '@prisma/client';

export interface RequestUser {
  id: string;
  email: string;
  role: Role;
  ageVerified: boolean;
  aiEnabled: boolean;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const REQUIRE_AGE_VERIFIED = 'requireAgeVerified';
/** Endpoint requires completed 18+ verification. */
export const RequireAgeVerified = () => SetMetadata(REQUIRE_AGE_VERIFIED, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const ACCESS_COOKIE = 'am_access';
export const REFRESH_COOKIE = 'am_refresh';
