<script setup lang="ts">
  // colorMode 預留給未來主題切換功能
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const colorMode = useColorMode()
</script>

<template>
  <UApp>
    <UContainer class="py-8">
      <NuxtPage />
    </UContainer>
  </UApp>
</template>
