/**
 * Optional Drizzle query-layer helper.
 *
 * Supabase migrations remain the persistence source of truth.
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const DRIZZLE_CLOSE_TIMEOUT_MS = 5

function getAdminDatabaseUrl(): string {
  const databaseUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('Missing ADMIN_DATABASE_URL or DATABASE_URL for Drizzle')
  }

  return databaseUrl
}

export function createAdminDrizzle() {
  const client = postgres(getAdminDatabaseUrl(), {
    prepare: false,
    max: 1,
  })

  const db = drizzle(client)

  return { client, db }
}

export async function withAdminDrizzle<T>(
  run: (context: ReturnType<typeof createAdminDrizzle>) => Promise<T>
): Promise<T> {
  const context = createAdminDrizzle()

  try {
    return await run(context)
  } finally {
    await context.client.end({ timeout: DRIZZLE_CLOSE_TIMEOUT_MS })
  }
}
