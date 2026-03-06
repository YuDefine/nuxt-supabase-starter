## Database

Type-safe SQL via Drizzle ORM. `db` and `schema` are auto-imported on server-side.

### Schema Definition

Place in `server/db/schema.ts` or `server/db/schema/*.ts`:

```ts
// server/db/schema.ts (SQLite)
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const users = sqliteTable('users', {
  id: integer().primaryKey({ autoIncrement: true }),
  name: text().notNull(),
  email: text().notNull().unique(),
  createdAt: integer({ mode: 'timestamp' }).notNull(),
})
```

PostgreSQL variant:

```ts
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: serial().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  createdAt: timestamp().notNull().defaultNow(),
})
```

### Database API

```ts
// db and schema are auto-imported on server-side
import { db, schema } from 'hub:db'

// Select
const users = await db.select().from(schema.users)
const user = await db.query.users.findFirst({ where: eq(schema.users.id, 1) })

// Insert
const [newUser] = await db
  .insert(schema.users)
  .values({ name: 'John', email: 'john@example.com' })
  .returning()

// Update
await db.update(schema.users).set({ name: 'Jane' }).where(eq(schema.users.id, 1))

// Delete
await db.delete(schema.users).where(eq(schema.users.id, 1))
```

### Migrations

```bash
npx nuxt db generate                  # Generate migrations from schema
npx nuxt db migrate                   # Apply pending migrations
npx nuxt db sql "SELECT * FROM users" # Execute raw SQL
npx nuxt db drop <TABLE>              # Drop a specific table
npx nuxt db drop-all                  # Drop all tables (v0.10.4+)
npx nuxt db squash                    # Squash migrations into one (v0.10.4+)
npx nuxt db mark-as-migrated [NAME]   # Mark as migrated without running
```

Migrations auto-apply during `npx nuxi dev` and `npx nuxi build`. Tracked in `_hub_migrations` table.

### Advanced Config

```ts
hub: {
  db: {
    dialect: 'postgresql',
    driver: 'postgres-js', // Optional: auto-detected
    casing: 'snake_case',  // camelCase JS -> snake_case DB
    migrationsDirs: ['server/db/custom-migrations/'],
    applyMigrationsDuringBuild: true // default
  },
  remote: true // Use production Cloudflare bindings in dev (v0.10.4+)
}
```

**remote mode:** When enabled, connects to production D1/KV/R2 during local development instead of local emulation. Useful for testing with production data.

### Database Providers

| Dialect    | Local                | Production                                                        |
| ---------- | -------------------- | ----------------------------------------------------------------- |
| sqlite     | `.data/db/sqlite.db` | D1 (Cloudflare), Turso (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`) |
| postgresql | PGlite               | postgres-js (`DATABASE_URL`), neon-http (`DATABASE_URL`)          |
| mysql      | -                    | mysql2 (`DATABASE_URL`, `MYSQL_URL`)                              |
