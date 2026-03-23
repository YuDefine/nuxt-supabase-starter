declare module '#auth-utils' {
  interface User {
    id: string
    email: string
    name: string
    picture?: string
    provider: string
  }

  interface UserSession {
    loggedInAt: number
  }
}

export {}
