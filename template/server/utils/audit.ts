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
 * Create an audit log entry (fire-and-forget)
 *
 * Errors are logged to console but do not throw.
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const client = getServerSupabaseClient()

    // audit_logs table may not exist until migration template is applied
    await (
      client as unknown as {
        from: (table: string) => { insert: (row: Record<string, unknown>) => Promise<unknown> }
      }
    )
      .from('audit_logs')
      .insert({
        user_id: entry.userId,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        changes: entry.changes ?? null,
        metadata: entry.metadata ?? null,
      })
  } catch (error) {
    console.error('[audit] Failed to create audit log:', error)
  }
}
