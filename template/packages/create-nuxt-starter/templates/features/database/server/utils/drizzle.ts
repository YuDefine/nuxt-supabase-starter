/**
 * Optional Drizzle query-layer helper.
 *
 * Supabase migrations remain the persistence source of truth.
 *
 * 整個 Nitro process **共用單一連線池**。若每次呼叫都開新連線再關閉，中量並發下
 * 會撞上 Postgres `max_connections`（Supabase 預設 100，且自身服務已吃掉一部分）；
 * 連線建立本身也有 TLS handshake 成本。
 */

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Sql } from 'postgres'

const DEFAULT_POOL_MAX = 10
const IDLE_TIMEOUT_SECONDS = 30
const CONNECT_TIMEOUT_SECONDS = 10
const CLOSE_TIMEOUT_SECONDS = 5

export type AdminDrizzle = PostgresJsDatabase<Record<string, never>>

let client: Sql | undefined
let db: AdminDrizzle | undefined

function getAdminDatabaseUrl(): string {
  const databaseUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL

  if (!databaseUrl) {
    throw new Error('Missing ADMIN_DATABASE_URL or DATABASE_URL for Drizzle')
  }

  return databaseUrl
}

function getPoolMax(): number {
  const raw = process.env.DATABASE_POOL_MAX

  if (!raw) return DEFAULT_POOL_MAX

  const parsed = Number.parseInt(raw, 10)

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid DATABASE_POOL_MAX: ${raw}`)
  }

  return parsed
}

/**
 * 取得共用的 admin Drizzle instance（首次呼叫時才建立連線池）。
 */
export function useAdminDrizzle(): AdminDrizzle {
  if (!db) {
    client = postgres(getAdminDatabaseUrl(), {
      // Supavisor / PgBouncer 的 transaction mode 不支援 prepared statements。
      // 直連 5432 時關掉它只損失少量效能，但省掉一個依部署形態而異的坑。
      prepare: false,
      max: getPoolMax(),
      idle_timeout: IDLE_TIMEOUT_SECONDS,
      connect_timeout: CONNECT_TIMEOUT_SECONDS,
    })

    db = drizzle(client)
  }

  return db
}

/**
 * 關閉連線池。由 Nitro `close` hook 呼叫；測試需要重建 instance 時亦可用。
 */
export async function closeAdminDrizzle(): Promise<void> {
  const current = client

  client = undefined
  db = undefined

  if (current) {
    await current.end({ timeout: CLOSE_TIMEOUT_SECONDS })
  }
}
