// seed profiles 的 canonical 值。SoT 是 supabase/seed.sql 的 profiles INSERT 區塊；
// 這份複刻給 BDD hook 在執行期復原用（snapshot 缺列時補回），
// test/unit/supabase/seed.test.ts 會把兩邊對帳防漂移。
export const SEED_PROFILES = [
  {
    id: '11111111-1111-7111-8111-111111111111',
    display_name: '管理員',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin',
    role: 'admin',
  },
  {
    id: '22222222-2222-7222-8222-222222222222',
    display_name: '測試使用者一',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user1',
    role: 'user',
  },
  {
    id: '33333333-3333-7333-8333-333333333333',
    display_name: '測試使用者二',
    avatar_url: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user2',
    role: 'user',
  },
] as const
