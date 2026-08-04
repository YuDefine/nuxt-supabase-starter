/**
 * Audit logging utility
 *
 * Fire-and-forget audit log creation. Errors are logged but do not
 * interrupt the calling API handler.
 */

import { getServerSupabaseClient } from './supabase'

interface AuditLogEntry {
  userId?: string
  action: string
  entityType: string
  entityId: string
  changes?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/**
 * PostgREST insert 的最小回傳形狀。
 *
 * 為什麼需要這個：`app/types/database.types.ts` 目前是空殼（`Tables: Record<string, never>`），
 * 要跑 `pnpm db:types` 對著實際 schema 才會生成，所以 `client.from('audit_logs')` 拿不到
 * 具名表的 overload。
 *
 * 關鍵是**保留 `{ error }`**：先前這裡的 cast 把 insert 宣告成 `Promise<unknown>`，
 * 於是 `{ error }` 在型別上不存在、忘記檢查也不會被 typecheck 抓到——那正是稽核記錄
 * 無聲丟失的根因。型別生成後這個 interface 與其下的 cast 可以一併刪除。
 */
interface PostgrestInsertResult {
  error: { message: string; code?: string } | null
}

type AuditLogInserter = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => Promise<PostgrestInsertResult>
  }
}

/**
 * Create an audit log entry (fire-and-forget)
 *
 * Errors are logged to console but do not throw.
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const client = getServerSupabaseClient() as unknown as AuditLogInserter

    const { error } = await client.from('audit_logs').insert({
      user_id: entry.userId,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
    })

    // PostgREST 把 DB 層的錯誤（RLS 拒絕、table 不存在、constraint 違反、欄位不符）
    // 放在 resolved 的 { error } 裡，**不** reject。只靠下面的 catch 會讓這些情況
    // 一律靜默成功 — 對稽核記錄而言等同無聲丟失。
    if (error) {
      console.error('[audit] Failed to create audit log:', error)
    }
  } catch (error) {
    // 這裡只接得到 client 建立失敗與傳輸層 throw。
    console.error('[audit] Failed to create audit log:', error)
  }
}
