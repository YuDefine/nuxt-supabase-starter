import type { PiniaColadaOptions } from '@pinia/colada'

/**
 * Pinia Colada 全域設定
 *
 * @see https://pinia-colada.esm.dev/guide/installation.html
 */
export default {
  // 資料被視為「新鮮」的時間（毫秒）
  // 在此期間內不會重新查詢
  staleTime: 30_000, // 30 秒

  // 未使用的快取資料保留時間（毫秒）
  // 超過後會被垃圾回收
  gcTime: 5 * 60_000, // 5 分鐘
} satisfies PiniaColadaOptions
