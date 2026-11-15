import { ForbiddenException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
  });
  readonly db = drizzle(this.pool);
  async verifyRole() {
    const result = await this.pool
      .query(`SELECT r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
      EXISTS(SELECT 1 FROM pg_class c WHERE c.relowner=r.oid AND c.relname IN ('tenants','memberships','campuses','audit_events')) AS owns_tables
      FROM pg_roles r WHERE r.rolname=current_user`);
    if (!result.rows[0] || Object.values(result.rows[0]).some(Boolean))
      throw new Error('DATABASE_URL must use a restricted runtime role');
  }
  async context<T>(
    actor: string,
    tenant: string | undefined,
    requestId: string,
    work: (db: NodePgDatabase) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.user_id', ${actor}, true), set_config('app.tenant_id', ${tenant ?? ''}, true), set_config('app.request_id', ${requestId}, true)`,
      );
      if (tenant) {
        const result = await tx.execute(
          sql`SELECT app.has_permission(${tenant}::uuid, 'read') AS allowed`,
        );
        if (!result.rows[0]?.allowed) throw new ForbiddenException('Tenant membership required');
      }
      return work(tx);
    });
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
