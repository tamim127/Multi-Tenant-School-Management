import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { FastifyRequest } from 'fastify';
import { Database } from './database';
import { sessions } from './schema';
import { tokenHash } from './password';
export type AuthRequest = FastifyRequest & { identity: { userId: string; sessionId: string } };
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(Database) private readonly database: Database) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    if (!authorization || !/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization))
      throw new UnauthorizedException();
    const [session] = await this.database.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.tokenHash, tokenHash(authorization.slice(7))),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    if (!session) throw new UnauthorizedException();
    request.identity = { userId: session.userId, sessionId: session.id };
    return true;
  }
}
