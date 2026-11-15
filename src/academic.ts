import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsObject, IsString, Length, Min } from 'class-validator';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuthRequest, SessionGuard } from './auth';
import { Database } from './database';

class PresetDto {
  @ApiProperty({ type: String, example: 'primary' })
  @IsString()
  @Length(1, 100)
  key!: string;
  @ApiProperty({ type: Number, example: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}
class AcademicRecordDto {
  @ApiProperty({
    type: Object,
    additionalProperties: true,
    example: { code: 'primary', name: 'Primary', unit_type: 'primary' },
  })
  @IsObject()
  data!: Record<string, unknown>;
}
const body = (expectedType: new () => object) =>
  new ValidationPipe({
    expectedType,
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
const tables = {
  categories: {
    table: 'institution_categories',
    writable: ['code', 'name', 'institution_type'],
    required: ['code', 'name', 'institution_type'],
  },
  sessions: {
    table: 'academic_sessions',
    writable: ['code', 'name', 'starts_on', 'ends_on'],
    required: ['code', 'name'],
  },
  programs: {
    table: 'academic_programs',
    writable: ['code', 'name', 'progression_model', 'curriculum_code', 'configuration'],
    required: ['code', 'name', 'progression_model'],
  },
  units: {
    table: 'academic_units',
    writable: [
      'code',
      'name',
      'unit_type',
      'campus_id',
      'parent_id',
      'program_id',
      'session_id',
      'sort_order',
      'configuration',
    ],
    required: ['code', 'name', 'unit_type'],
  },
  levels: {
    table: 'academic_levels',
    writable: ['program_id', 'code', 'name', 'sort_order', 'configuration'],
    required: ['program_id', 'code', 'name'],
  },
  assignments: {
    table: 'academic_level_assignments',
    writable: ['unit_id', 'level_id'],
    required: ['unit_id', 'level_id'],
  },
  terms: {
    table: 'academic_terms',
    writable: ['session_id', 'code', 'name', 'starts_on', 'ends_on', 'sort_order'],
    required: ['session_id', 'code', 'name'],
  },
  periods: {
    table: 'academic_periods',
    writable: ['level_id', 'term_id', 'code', 'name', 'period_type', 'sort_order'],
    required: ['level_id', 'code', 'name', 'period_type'],
  },
  groups: {
    table: 'academic_groups',
    writable: ['period_id', 'code', 'name', 'group_type'],
    required: ['period_id', 'code', 'name', 'group_type'],
  },
  subjects: {
    table: 'academic_subjects',
    writable: ['program_id', 'period_id', 'code', 'name', 'subject_type', 'configuration'],
    required: ['program_id', 'code', 'name', 'subject_type'],
  },
} as const;
type Resource = keyof typeof tables;
function config(resource: string) {
  if (!(resource in tables)) throw new NotFoundException('Unknown academic resource');
  return tables[resource as Resource];
}
function data(
  input: Record<string, unknown>,
  resource: ReturnType<typeof config>,
  create: boolean,
) {
  const entries = Object.entries(input);
  if (!entries.length || entries.some(([key]) => !resource.writable.includes(key as never)))
    throw new BadRequestException('Invalid academic fields');
  if (create && resource.required.some((key) => input[key] === undefined || input[key] === null))
    throw new BadRequestException('Required academic fields missing');
  for (const [key, value] of entries) {
    if (key === 'configuration') {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('Configuration must be an object');
    } else if (key === 'sort_order') {
      if (!Number.isInteger(value)) throw new BadRequestException('Order must be an integer');
    } else if (
      value !== null &&
      (typeof value !== 'string' || value.length > 120 || value.length === 0)
    )
      throw new BadRequestException('Invalid academic value');
  }
  return entries;
}

@ApiTags('academic')
@ApiBearerAuth()
@UseGuards(SessionGuard)
@Controller('tenants/:tenantId/academic')
export class AcademicController {
  constructor(@Inject(Database) private readonly database: Database) {}
  private scoped<T>(req: AuthRequest, tenantId: string, fn: (db: NodePgDatabase) => Promise<T>) {
    return this.database.context(req.identity.userId, tenantId, req.id, fn);
  }
  private async canWrite(db: NodePgDatabase, tenantId: string) {
    const result = await db.execute(
      sql`SELECT app.has_permission(${tenantId}::uuid,'academic:write') AS allowed`,
    );
    if (!result.rows[0]?.allowed)
      throw new ForbiddenException('Academic configuration permission required');
  }
  private async audit(
    db: NodePgDatabase,
    req: AuthRequest,
    tenantId: string,
    action: string,
    id: string,
  ) {
    await db.execute(
      sql`INSERT INTO audit_events(tenant_id,actor_id,action,resource_id,request_id) VALUES(${tenantId}::uuid,${req.identity.userId}::uuid,${action},${id}::uuid,${req.id})`,
    );
  }
  @Get('presets') async presets(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(req, tenantId, async (db) => ({
      items: (
        await db.execute(
          sql`SELECT key,version,institution_type,category,definition FROM academic_presets ORDER BY key,version`,
        )
      ).rows,
    }));
  }
  @Post('apply-preset')
  @ApiBody({ type: PresetDto })
  async apply(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body(body(PresetDto)) input: PresetDto,
  ) {
    return this.scoped(req, tenantId, async (db) => ({
      applied: (
        await db.execute(
          sql`SELECT app.apply_academic_preset(${tenantId}::uuid,${input.key},${input.version}) AS applied`,
        )
      ).rows[0].applied,
    }));
  }
  @Get('active') async active(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ) {
    return this.scoped(req, tenantId, async (db) => {
      const result: Record<string, unknown[]> = {};
      for (const [resource, definition] of Object.entries(tables))
        result[resource] = (
          await db.execute(
            sql`SELECT * FROM ${sql.raw(definition.table)} WHERE tenant_id=${tenantId}::uuid AND archived_at IS NULL ORDER BY created_at,id LIMIT 500`,
          )
        ).rows;
      return result;
    });
  }
  @Get(':resource') async list(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('resource') resource: string,
  ) {
    const definition = config(resource);
    return this.scoped(req, tenantId, async (db) => ({
      items: (
        await db.execute(
          sql`SELECT * FROM ${sql.raw(definition.table)} WHERE tenant_id=${tenantId}::uuid ORDER BY ${sql.raw(['academic_levels', 'academic_units', 'academic_terms', 'academic_periods'].includes(definition.table) ? 'sort_order,' : '')} created_at,id LIMIT 500`,
        )
      ).rows,
    }));
  }
  @Get(':resource/:id/history')
  async history(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const definition = config(resource);
    return this.scoped(req, tenantId, async (db) => ({
      items: (
        await db.execute(
          sql`SELECT id,resource_id,prior_row,changed_at FROM academic_structure_history WHERE tenant_id=${tenantId}::uuid AND resource=${definition.table} AND resource_id=${id}::uuid ORDER BY changed_at,id LIMIT 500`,
        )
      ).rows,
    }));
  }
  @Post(':resource')
  @ApiBody({ type: AcademicRecordDto })
  async create(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('resource') resource: string,
    @Body(body(AcademicRecordDto)) input: AcademicRecordDto,
  ) {
    const definition = config(resource);
    const entries = data(input.data, definition, true);
    return this.scoped(req, tenantId, async (db) => {
      await this.canWrite(db, tenantId);
      const columns = sql.join(
        entries.map(([key]) => sql.raw(key)),
        sql`, `,
      );
      const values = sql.join(
        entries.map(([key, value]) =>
          key === 'configuration' ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`,
        ),
        sql`, `,
      );
      const [created] = (
        await db.execute(
          sql`INSERT INTO ${sql.raw(definition.table)} (tenant_id,${columns}) VALUES(${tenantId}::uuid,${values}) RETURNING *`,
        )
      ).rows;
      await this.audit(db, req, tenantId, `academic.${resource}.created`, String(created.id));
      return created;
    });
  }
  @Patch(':resource/:id')
  @ApiBody({ type: AcademicRecordDto })
  async update(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(body(AcademicRecordDto)) input: AcademicRecordDto,
  ) {
    const definition = config(resource);
    const entries = data(input.data, definition, false);
    return this.scoped(req, tenantId, async (db) => {
      await this.canWrite(db, tenantId);
      const sets = sql.join(
        entries.map(
          ([key, value]) =>
            sql`${sql.raw(key)} = ${key === 'configuration' ? sql`${JSON.stringify(value)}::jsonb` : sql`${value}`}`,
        ),
        sql`, `,
      );
      const [updated] = (
        await db.execute(
          sql`UPDATE ${sql.raw(definition.table)} SET ${sets} WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid AND archived_at IS NULL RETURNING *`,
        )
      ).rows;
      if (!updated) throw new NotFoundException();
      await this.audit(db, req, tenantId, `academic.${resource}.updated`, id);
      return updated;
    });
  }
  @Post(':resource/:id/archive')
  @HttpCode(200)
  async archive(
    @Req() req: AuthRequest,
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('resource') resource: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const definition = config(resource);
    return this.scoped(req, tenantId, async (db) => {
      await this.canWrite(db, tenantId);
      const [archived] = (
        await db.execute(
          sql`UPDATE ${sql.raw(definition.table)} SET archived_at=now() WHERE tenant_id=${tenantId}::uuid AND id=${id}::uuid AND archived_at IS NULL RETURNING *`,
        )
      ).rows;
      if (!archived) throw new NotFoundException();
      await this.audit(db, req, tenantId, `academic.${resource}.archived`, id);
      return archived;
    });
  }
}
