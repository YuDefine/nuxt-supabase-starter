// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/DirtyTracker.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/DirtyTracker.ts
/**
 * 髒資源追蹤。Cleanup plugin 用來判斷哪些資源被測試碰過、需要清理。
 *
 * 鍵的語意由 cleanup plugin 自定：
 *   - RDB plugin：table name（小寫）
 *   - Redis plugin：key prefix 或 hash tag
 *   - S3 plugin：bucket+object key
 *
 * 沒有 tracking 資訊時（tracker 為 null 或 dirty 集合為 null）→ plugin 應 fallback
 * 為「全清」或「不清」，由 plugin 文件規範。
 */
export interface DirtyTracker {
  /**
   * 取得此 scenario 期間被標記為髒之資源鍵集合。
   * null 表示「沒有 tracking 資訊」，與「空集合（沒有任何髒資源）」語意不同。
   */
  dirty(): ReadonlySet<string> | null;

  /** 將某個資源鍵標記為髒。 */
  markDirty(key: string): void;

  /** 清空 dirty 標記（通常在 cleanup 結束後呼叫）。 */
  clear(): void;
}
