// 🔒 LOCKED — managed by clade · Source: vendor/scripts/lib/worktree-backlog.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/scripts/lib/worktree-backlog.ts
import { WORKTREE_BACKLOG_LIMIT, type WorktreeBacklog } from '../flow/worktree-backlog.ts'

// Preserve the helper API while flow owns the shared CLI boundary.
export {
  WORKTREE_BACKLOG_LIMIT,
  WORKTREE_STALE_DAYS,
  parseWorktreeBacklog,
  resolveWtHelper,
  type WorktreeBacklog,
  type WorktreeBacklogEntry,
} from '../flow/worktree-backlog.ts'

/** An inspection queue, never deletion or landing authorization. */
export function formatWorktreeBacklog(report: WorktreeBacklog): string {
  if (!report.exceeded) return ''
  return [
    `⚠️ worktree 堆積：${report.entries.length} 棵待處置（門檻 > ${WORKTREE_BACKLOG_LIMIT}）`,
    ...report.entries.map(
      (row) =>
        `- ${row.slug} [${row.landedState}, dirty=${row.dirty ?? '?'}, ${row.daysOld ?? '?'}d] — ${row.action}${row.supersededBy.length ? `；取代候選：${row.supersededBy.join(' / ')}` : ''}`,
    ),
    '',
  ].join('\n')
}
