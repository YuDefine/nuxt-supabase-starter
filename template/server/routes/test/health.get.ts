// 測試控制面：GET /test/health（TD-026 D5）
// 放 server/routes/ 不是 server/api/ —— 後者會被掛到 /api/test/health。
// environment.ts 輪詢這支確認 dev server 就緒。production 由
// server/middleware/00.test-routes-guard.ts 擋成 404。
import { defineEventHandler } from 'h3'

export default defineEventHandler(() => ({ status: 'ok' }))
