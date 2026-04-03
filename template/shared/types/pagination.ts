/**
 * 分頁型別定義
 *
 * Client/Server 共用的分頁結構。
 *
 * @module shared/types/pagination
 */

export interface PaginationInput {
  page: number
  perPage: number
  total: number
}

export interface PaginationMeta {
  page: number
  perPage: number
  total: number
  totalPages: number
}

export interface PaginatedResponse<T> {
  data: T[]
  pagination: PaginationMeta
}
