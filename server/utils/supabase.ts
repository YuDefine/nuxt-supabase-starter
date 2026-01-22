/**
 * Supabase Server 工具函式
 *
 * 提供 Server-side Supabase 存取：
 * - getServerSupabaseClient(): Service Role Client（無 RLS 限制）
 *
 * @module server/utils/supabase
 */

// @ts-expect-error - @supabase/supabase-js 類型檔案暫時缺失
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "~~/app/types/database.types";

// Module-level singleton
let serviceClient: SupabaseClient<Database> | null = null;

/**
 * 取得 Supabase Service Role Client（Singleton）
 *
 * 使用 Service Role Key，繞過所有 RLS 限制。
 *
 * ⚠️ 注意：此 Client 無 RLS 保護，請謹慎使用！
 */
export function getServerSupabaseClient(): SupabaseClient<Database> {
  if (serviceClient) {
    return serviceClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw createError({
      statusCode: 500,
      message: "伺服器設定錯誤：缺少 Supabase 環境變數",
    });
  }

  serviceClient = createClient<Database>(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceClient;
}
