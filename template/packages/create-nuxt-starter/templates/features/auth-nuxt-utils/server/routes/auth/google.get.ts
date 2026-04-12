export default defineOAuthGoogleEventHandler({
  async onSuccess(event, { user: googleUser }) {
    await setUserSession(event, {
      user: {
        id: googleUser.sub as string,
        email: googleUser.email as string,
        name: googleUser.name as string,
        picture: googleUser.picture as string | undefined,
        provider: 'google',
      },
      loggedInAt: Date.now(),
    })

    const rawRedirect = getCookie(event, 'auth-redirect') || '/'
    deleteCookie(event, 'auth-redirect')
    const redirectPath =
      rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/'
    return sendRedirect(event, redirectPath)
  },

  onError(event) {
    return sendRedirect(event, '/auth/login?error=google_auth_failed')
  },
})
