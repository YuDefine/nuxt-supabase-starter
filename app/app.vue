<script setup lang="ts">
  const colorMode = useColorMode()

  function toggleColorMode() {
    colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
  }
</script>

<template>
  <UApp>
    <UContainer class="py-8">
      <NuxtPage />
    </UContainer>
  </UApp>
</template>
