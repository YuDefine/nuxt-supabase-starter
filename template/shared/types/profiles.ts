/**
 * Profile 型別定義
 *
 * Client/Server 共用型別的相容轉發層。
 * 新增或修改契約時，請優先編輯 `shared/schemas/profiles.ts`。
 *
 * @module shared/types/profiles
 */

export type {
  Profile,
  ProfileListQuery,
  ProfileUpdateBody,
  ProfileListResponse,
  ProfileResponse,
} from '../schemas/profiles'
