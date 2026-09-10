// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/plugin-api/src/SpecSource.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/plugin-api/src/SpecSource.ts
/**
 * Spec 來源抽象。讓 SpecReader 不必綁定 fs / inline / 任一具體機制。
 *
 * Node.js 實作通常為 fs path 或 inline string；瀏覽器 / 其他 runtime 可衍生其他 source 型別。
 */
export interface SpecSource {
  /**
   * 來源之識別字串（檔案路徑、classpath URI 或 inline 標籤）。
   * 用於錯誤訊息與 logging。
   */
  readonly identifier: string;

  /** 讀取此 source 之文字內容；async（fs 可能為 sync 但統一回 Promise）。 */
  read(): Promise<string>;

  /**
   * 若此 source 代表一個目錄 / 集合，回傳目錄下符合條件之所有子 source；
   * 否則 → 單元素 list（自身）。
   */
  children(): Promise<readonly SpecSource[]>;

  /** 是否為集合（資料夾）。 */
  isCollection(): boolean;
}
