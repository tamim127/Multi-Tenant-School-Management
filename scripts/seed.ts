import 'dotenv/config';
import { eq, sql } from 'drizzle-orm';
import { Database } from '../src/database';
import { users } from '../src/schema';
import { hashPassword } from '../src/password';

async function main() {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Synthetic seed disabled in production');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  const database = new Database();
  try {
    await database.verifyRole();
    for (const key of ['alpha', 'beta']) {
      const email = `owner.${key}@example.test`;
      await database.db
        .insert(users)
        .values({
          email,
          displayName: `Synthetic ${key} Owner`,
          passwordHash: await hashPassword('Synthetic-Only-2026!'),
        })
        .onConflictDoNothing();
      const [user] = await database.db.select().from(users).where(eq(users.email, email));
      await database.context(user.id, undefined, 'seed', async (db) => {
        const existing = await db.execute(sql`SELECT * FROM app.my_tenants()`);
        if (!existing.rows.length)
          await db.execute(
            sql`SELECT app.provision_school(${`Synthetic ${key} School`},${`synthetic-${key}`})`,
          );
      });
      console.log(`Ready: ${email}`);
    }
  } finally {
    await database.onModuleDestroy();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
