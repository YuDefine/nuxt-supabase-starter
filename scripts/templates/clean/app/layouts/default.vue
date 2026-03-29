<script setup lang="ts">
  const colorMode = useColorMode()
  const { loggedIn, user, signOut } = useUserSession()
  const route = useRoute()
  const currentYear = new Date().getFullYear()

  const navItems = computed(() => [
    {
      label: 'Home',
      icon: 'i-lucide-home',
      to: '/',
      active: route.path === '/',
    },
  ])

  const userMenuItems = computed(() => [
    {
      label: user.value?.name || user.value?.email || 'User',
      type: 'label' as const,
    },
    {
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: '/settings',
    },
    {
      type: 'separator' as const,
    },
    {
      label: 'Sign out',
      icon: 'i-lucide-log-out',
      onSelect: async () => {
        await signOut()
        await navigateTo('/auth/login')
      },
    },
  ])

  function toggleColorMode() {
    colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
  }
</script>

<template>
  <div class="flex min-h-screen flex-col bg-(--ui-bg)">
    <!-- Header -->
    <header class="border-b border-(--ui-border)">
      <UContainer>
        <div class="flex h-16 items-center justify-between">
          <!-- Logo + Nav -->
          <div class="flex items-center gap-6">
            <NuxtLink to="/" class="text-lg font-bold text-(--ui-text-highlighted)">
              {{ PROJECT_NAME }}
            </NuxtLink>

            <UNavigationMenu :items="navItems" class="hidden sm:flex" />
          </div>

          <!-- Right side: dark mode + user -->
          <div class="flex items-center gap-2">
            <UButton
              :icon="colorMode.value === 'dark' ? 'i-lucide-sun' : 'i-lucide-moon'"
              variant="ghost"
              color="neutral"
              @click="toggleColorMode"
            />

            <template v-if="loggedIn">
              <UDropdownMenu :items="userMenuItems">
                <UButton variant="ghost" color="neutral" icon="i-lucide-user" />
              </UDropdownMenu>
            </template>
            <template v-else>
              <UButton to="/auth/login" variant="soft" size="sm"> Sign in </UButton>
            </template>
          </div>
        </div>
      </UContainer>
    </header>

    <!-- Mobile nav -->
    <nav class="border-b border-(--ui-border) sm:hidden">
      <UContainer>
        <UNavigationMenu :items="navItems" orientation="horizontal" />
      </UContainer>
    </nav>

    <!-- Main content -->
    <main class="flex-1">
      <UContainer class="py-8">
        <slot />
      </UContainer>
    </main>

    <!-- Footer -->
    <footer class="border-t border-(--ui-border)">
      <UContainer>
        <div class="flex h-14 items-center justify-between text-sm text-(--ui-text-muted)">
          <span>&copy; {{ currentYear }} {{ PROJECT_NAME }}</span>
          <span>Built with Nuxt UI</span>
        </div>
      </UContainer>
    </footer>
  </div>
</template>
