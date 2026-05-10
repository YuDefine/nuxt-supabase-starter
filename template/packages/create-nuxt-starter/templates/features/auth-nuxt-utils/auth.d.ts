declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    picture?: string
    provider: string
    /**
     * Role identifier surfaced by dev-login canonical lookup
     * (clade rules/modules/auth/nuxt-auth-utils/dev-login.md). Consumer 可以
     * narrow 為自家 role enum / table 的型別。
     */
    role?: string
    /** Multi-tenant consumer 用；single-tenant 可忽略。 */
    tenantId?: string
    /** Org / department scoping；可選。 */
    departmentId?: string | null
  }

  interface UserSession {
    loggedInAt: number
  }
}

export {}
