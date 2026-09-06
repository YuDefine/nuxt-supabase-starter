/**
 * Nitro 關閉時收掉 admin Drizzle 連線池。
 *
 * 連線池本身是 lazy 建立的（見 `server/utils/drizzle.ts`），此 plugin 只負責關閉，
 * 不在啟動時強制連線——DB 暫時不可用時不該讓整個 process 起不來。
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', async () => {
    await closeAdminDrizzle()
  })
})
