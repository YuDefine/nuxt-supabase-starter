// 🔒 LOCKED — managed by clade · Source: vendor/specformula-ts/packages/core/src/auth/Authenticator.ts · 改這裡無效，下次 propagate 會覆寫；請改 $CLADE_HOME/vendor/specformula-ts/packages/core/src/auth/Authenticator.ts
/**
 * Authentication abstraction for HTTP test requests.
 * Mirrors Java's Authenticator interface.
 */
export interface Authenticator {
  buildAuthHeaders(token: string): Promise<Readonly<Record<string, string>>>;

  /**
   * Resolve an actor identifier to a bearer token.
   *
   * 與 Java 端 `Authenticator.getToken(Object actorId): String` 對齊。
   * benchmark 端 BDD 透過 ISA `(UID="$Actor.id")` capture 到的是 actor id
   * （資料庫主鍵 / 業務 ID），需要由 Authenticator 進一步換成可帶入
   * `Authorization: Bearer ...` 的 token。
   *
   * 標 optional 是為了讓既有 `buildAuthHeaders`-only 的實作不必立即遷移；
   * 未實作此方法時，dispatcher 會 fallback 到「把 context value 當 token」
   * 的舊行為以維持向下相容。
   */
  getToken?(actorId: unknown): string | null | Promise<string | null>;
}
