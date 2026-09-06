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

/** Validate the SDK boundary while database.types.ts remains a scaffold placeholder. */
async function insertAuditRow(row: Record<string, unknown>) {
  const builder: unknown = getServerSupabaseClient().from('audit_logs')
  if (
    typeof builder !== 'object' ||
    builder === null ||
    !('insert' in builder) ||
    typeof builder.insert !== 'function'
  ) {
    throw new TypeError('Invalid audit insert builder')
  }
  const result: unknown = await builder.insert(row)
  if (typeof result !== 'object' || result === null || !('error' in result)) {
    throw new TypeError('Invalid audit insert response')
  }
  const error = result.error
  if (
    error !== null &&
    (typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string')
  ) {
    throw new TypeError('Invalid audit insert error')
  }
  return { error }
}

/**
 * Create an audit log entry (fire-and-forget)
 *
 * Errors are logged to console but do not throw.
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const { error } = await insertAuditRow({
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
    // Report client initialization, boundary validation and transport failures.
    console.error('[audit] Failed to create audit log:', error)
  }
}
