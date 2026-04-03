// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-05-15',
  ssr: false,

  modules: [
    // __MODULES__
  ],

  css: ['~/assets/css/main.css'],

  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],

  typescript: {
    typeCheck: true,
  },

  runtimeConfig: {
    // __RUNTIME_CONFIG__
    public: {
      // __RUNTIME_CONFIG_PUBLIC__
    },
  },

  // __CONFIG_BLOCKS__

  devtools: {
    enabled: true,
  },

  // __NITRO_CONFIG__
})
