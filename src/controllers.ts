import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomBytes } from 'node:crypto';
import { Database } from './database';
import { AuthRequest, SessionGuard } from './auth';
import {
  CampusDto,
  LoginDto,
  MembershipDto,
  ProfileDto,
  RegisterDto,
  RoleDto,
  TenantDto,
} from './dto';
import { auditEvents, campuses, memberships, sessions, tenants, users } from './schema';
import { hashPassword, tokenHash, verifyPassword } from './password';

// Explicit expectedType also keeps validation correct in tsx/esbuild development runs.
const body = (expectedType: new () => object) =>
  new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
const userFields = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  createdAt: users.createdAt,
};

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get('live') live() {
    return { status: 'ok' };
  }
  @Get('ready') async ready() {
    try {
      await this.database.pool.query('SELECT 1 FROM tenants LIMIT 0');
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Post('register')
  @ApiBody({ type: RegisterDto })
  async register(@Body(body(RegisterDto)) input: RegisterDto) {
    const [user] = await this.database.db
      .insert(users)
      .values({
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
      })
      .returning(userFields);
    return user;
  }
  @Post('login')
  @HttpCode(200)
  @ApiBody({ type: LoginDto })
  async login(@Body(body(LoginDto)) input: LoginDto) {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()));
    // Perform scrypt for unknown accounts too; never log credentials or tokens.
    const dummy = 'scrypt:00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? dummy);
    if (!user || !valid) throw new UnauthorizedException('Invalid credentials');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() + Number(process.env.SESSION_TTL_SECONDS ?? 28800) * 1000,
    );
    const [session] = await this.database.db
      .insert(sessions)
      .values({ userId: user.id, tokenHash: tokenHash(token), expiresAt })
      .returning({ id: sessions.id });
    return { accessToken: token, tokenType: 'Bearer', expiresAt, sessionId: session.id };
  }
  @Get('sessions')
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  async list(@Req() request: AuthRequest) {
    return {
      items: await this.database.db
        .select({
          id: sessions.id,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .where(eq(sessions.userId, request.identity.userId))
        .orderBy(desc(sessions.createdAt))
        .limit(100),
    };
  }
  @Delete('sessions/:id')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  async revoke(@Req() request: AuthRequest, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.id, id), eq(sessions.userId, request.identity.userId)))
      .returning({ id: sessions.id });
    if (!result.length) throw new NotFoundException();
  }
  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionGuard)
  @ApiBearerAuth()
  async logout(@Req() request: AuthRequest) {
    await this.database.db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, request.identity.sessionId));
  }
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('users')
export class UsersController {
  constructor(@Inject(Database) private readonly database: Database) {}
  @Get('me') async me(@Req() request: AuthRequest) {
    return (
      await this.database.db
        .select(userFields)
        .from(users)
        .where(eq(users.id, request.identity.userId))
    )[0];
  }
  @Patch('me')
  @ApiBody({ type: ProfileDto })
  async update(@Req() request: AuthRequest, @Body(body(ProfileDto)) input: ProfileDto) {
    return (
      await this.database.db
        .update(users)
        .set(input)
        .where(eq(users.id, request.identity.userId))
        .returning(userFields)
    )[0];
  }
}

@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('tenants')
export class TenantsController {
  constructor(@Inject(Database) private readonly database: Database) {}
  private scoped<T>(
    request: AuthRequest,
    tenant: string | undefined,
    work: (db: NodePgDatabase) => Promise<T>,
  ) {
    return this.database.context(request.identity.userId, tenant, request.id, work);
  }
  private async audit(
    db: NodePgDatabase,
    request: AuthRequest,
    tenantId: string,
    action: string,
    resourceId: string,
  ) {
    await db.insert(auditEvents).values({
      tenantId,
      actorId: request.identity.userId,
      action,
      resourceId,
      requestId: request.id,
    });
  }
  @Get() async list(@Req() request: AuthRequest) {
    return this.scoped(request, undefined, async (db) => ({
      items: (await db.execute(sql`SELECT * FROM app.my_tenants() ORDER BY id LIMIT 100`)).rows,
    }));
  }
  @Post()
  @ApiBody({ type: TenantDto })
  @ApiOperation({ summary: 'Atomically provision a tenant with School preset v1' })
  async provision(@Req() request: AuthRequest, @Body(body(TenantDto)) input: TenantDto) {
    return this.scoped(
      request,
      undefined,
      async (db) =>
        (await db.execute(sql`SELECT app.provision_school(${input.name},${input.slug}) AS id`))
          .rows[0],
    );
  }
  @Get(':tenantId') async get(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(
      request,
      tenantId,
      async (db) => (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0],
    );
  }
  @Patch(':tenantId')
  @ApiBody({ type: ProfileDto })
  async rename(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(body(ProfileDto)) input: ProfileDto,
  ) {
    return this.scoped(request, tenantId, async (db) => {
      const [result] = await db
        .update(tenants)
        .set({ name: input.displayName })
        .where(eq(tenants.id, tenantId))
        .returning();
      if (!result) throw new NotFoundException();
      await this.audit(db, request, tenantId, 'tenant.updated', tenantId);
      return result;
    });
  }
  @Get(':tenantId/campuses') async campusList(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(request, tenantId, async (db) => ({
      items: await db
        .select()
        .from(campuses)
        .where(eq(campuses.tenantId, tenantId))
        .orderBy(campuses.id)
        .limit(100),
    }));
  }
  @Post(':tenantId/campuses')
  @ApiBody({ type: CampusDto })
  async campusCreate(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(body(CampusDto)) input: CampusDto,
  ) {
    return this.scoped(request, tenantId, async (db) => {
      const [result] = await db
        .insert(campuses)
        .values({ ...input, tenantId })
        .returning();
      await this.audit(db, request, tenantId, 'campus.created', result.id);
      return result;
    });
  }
  @Patch(':tenantId/campuses/:id')
  @ApiBody({ type: CampusDto })
  async campusUpdate(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(body(CampusDto)) input: CampusDto,
  ) {
    return this.scoped(request, tenantId, async (db) => {
      const [result] = await db
        .update(campuses)
        .set(input)
        .where(and(eq(campuses.id, id), eq(campuses.tenantId, tenantId)))
        .returning();
      if (!result) throw new NotFoundException();
      await this.audit(db, request, tenantId, 'campus.updated', id);
      return result;
    });
  }
  @Get(':tenantId/memberships') async memberList(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(request, tenantId, async (db) => ({
      items: await db
        .select()
        .from(memberships)
        .where(eq(memberships.tenantId, tenantId))
        .orderBy(memberships.id)
        .limit(100),
    }));
  }
  @Get(':tenantId/users') async userList(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(request, tenantId, async (db) => ({
      items: await db
        .select(userFields)
        .from(users)
        .innerJoin(memberships, eq(users.id, memberships.userId))
        .where(eq(memberships.tenantId, tenantId))
        .orderBy(users.id)
        .limit(100),
    }));
  }
  @Post(':tenantId/memberships')
  @ApiBody({ type: MembershipDto })
  async memberCreate(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(body(MembershipDto)) input: MembershipDto,
  ) {
    return this.scoped(request, tenantId, async (db) => {
      const [result] = await db
        .insert(memberships)
        .values({ ...input, tenantId })
        .returning();
      await this.audit(db, request, tenantId, 'membership.created', result.id);
      return result;
    });
  }
  @Patch(':tenantId/memberships/:id')
  @ApiBody({ type: RoleDto })
  async memberUpdate(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(body(RoleDto)) input: RoleDto,
  ) {
    return this.scoped(request, tenantId, async (db) => {
      const [result] = await db
        .update(memberships)
        .set(input)
        .where(and(eq(memberships.id, id), eq(memberships.tenantId, tenantId)))
        .returning();
      if (!result) throw new NotFoundException();
      await this.audit(db, request, tenantId, 'membership.updated', id);
      return result;
    });
  }
  @Delete(':tenantId/memberships/:id')
  @HttpCode(204)
  async memberDelete(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.scoped(request, tenantId, async (db) => {
      const [result] = await db
        .delete(memberships)
        .where(and(eq(memberships.id, id), eq(memberships.tenantId, tenantId)))
        .returning();
      if (!result) throw new NotFoundException();
      await this.audit(db, request, tenantId, 'membership.deleted', id);
    });
  }
  @Get(':tenantId/permissions') async permissions(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(request, tenantId, async (db) => ({
      items: (
        await db.execute(
          sql`SELECT p AS permission FROM unnest(ARRAY['read','campus:write','membership:write','tenant:write','audit:read']) p WHERE app.has_permission(${tenantId}::uuid,p)`,
        )
      ).rows,
    }));
  }
  @Get(':tenantId/audit-events') async auditList(
    @Req() request: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(request, tenantId, async (db) => ({
      items: await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, tenantId))
        .orderBy(desc(auditEvents.createdAt), auditEvents.id)
        .limit(100),
    }));
  }
}
