// vendor/doctor-shared/preset.mjs — clade-governed vite-doctor rule baseline
//
// Single source of truth for Nuxt consumer vite-doctor rule severity.
// Follows the same import+override pattern as vendor/oxc-shared/preset.mjs.
//
// Consumer usage (nuxt.config.ts):
//
//   import { doctorConfig } from './vendor/doctor-shared/preset.mjs'
//
//   export default defineNuxtConfig({
//     modules: [
//       ['vite-doctor/nuxt', doctorConfig],
//     ],
//   })
//
// To override a rule per-consumer:
//
//   import { doctorConfig, doctorRules } from './vendor/doctor-shared/preset.mjs'
//
//   export default defineNuxtConfig({
//     modules: [
//       ['vite-doctor/nuxt', {
//         config: {
//           rules: { ...doctorRules, 'nuxt-ui/prefer-u-button': 'off' },
//         },
//       }],
//     ],
//   })

// Rule IDs MUST match vite-doctor's registered plugin namespaces (verified against
// vite-doctor@0.0.1). vite-doctor silently ignores unknown keys, so a mis-namespaced
// id leaves the rule at its built-in default instead of the severity set here. The
// namespaces are NOT uniformly `nuxt/<category>/<rule>`: image / scripts / ui / content
// / better-auth / nuxthub / vueuse rules live under their own top-level namespace.
export const doctorRules = {
  // === Hydration (critical — SSR/CSR mismatch = white screen) ===
  'nuxt/hydration/no-browser-global-in-universal-code': 'error',
  'nuxt/hydration/no-browser-side-effects-in-setup': 'error',
  'nuxt/hydration/no-client-conditional-in-template': 'error',
  'nuxt/hydration/no-time-dependent-render-without-nuxttime-or-clientonly': 'error',
  'nuxt/hydration/prefer-usecookie-for-initial-client-state': 'error',
  'vueuse/prefer-usebreakpoints': 'warn',
  'vueuse/prefer-usewindow-size': 'warn',

  // === Fetch / Data fetching (common source of bugs) ===
  'nuxt/fetch/no-raw-fetch-in-setup': 'error',
  'nuxt/fetch/forward-auth-headers-ssr': 'error',
  'nuxt/fetch/require-stable-asyncdata-key': 'error',
  'nuxt/fetch/prefer-create-use-fetch': 'warn',
  'nuxt/fetch/no-await-inside-custom-wrapper': 'error',
  'nuxt/fetch/create-usefetch-must-be-exported-in-scanned-dir': 'warn',
  'nuxt/fetch/keyed-composable-registration-required': 'warn',
  'nuxt/async-data-explicit-key-for-refreshable': 'error',
  'nuxt/async-data-handler-pure': 'error',
  'nuxt/async-data-no-mutation-methods': 'error',
  'nuxt/no-global-refresh-without-justification': 'warn',
  'nuxt/no-manual-action-usefetch': 'warn',
  'nuxt/no-mutation-toast-in-usefetch-callback': 'error',
  'nuxt/post-fetch-requires-readonly-marker': 'warn',
  'nuxt/preview-mode-global-refresh': 'warn',

  // === Routing ===
  'nuxt/routing/prefer-nuxt-useroute': 'error',
  'nuxt/routing/prefer-nuxtlink': 'error',
  'nuxt/routing/prefer-nuxtpage-over-routerview': 'error',
  'nuxt/routing/return-navigateto-in-middleware': 'error',
  'nuxt/routing/no-hash-sensitive-route-fullpath-in-ssr-markup': 'error',
  'nuxt/routing/no-route-object-page-key': 'error',
  'nuxt/routing/no-router-navigation-in-setup': 'error',
  'nuxt/routing/no-useroute-in-middleware': 'error',

  // === Security ===
  'nuxt/security/no-unsafe-usehead-script': 'error',
  'nuxt/security/prefer-useheadsafe-for-untrusted-values': 'error',
  'nuxt/runtime/no-plain-env-in-app-code': 'error',
  'nuxt/runtime/no-secret-in-public-config': 'error',
  'nuxt/middleware/no-route-middleware-api-security': 'error',

  // === Context / Lifecycle ===
  'nuxt/context/no-composable-after-await': 'error',
  'nuxt/context/no-legacy-process-client-server': 'error',
  'vueuse/prefer-use-timers': 'warn',

  // === State ===
  'nuxt/state/no-nonserializable-usestate': 'error',
  'nuxt/state/prefer-explicit-usestate-key-in-exported-composables': 'warn',

  // === Imports ===
  'nuxt/imports/no-auto-import-collision': 'error',
  'nuxt/imports/no-conflicting-usefetch-import': 'error',
  'nuxt/imports/no-explicit-auto-import': 'warn',
  'vueuse/no-nuxt-auto-import-collision': 'error',

  // === Composables / Plugins ===
  'nuxt/composables/no-nested-autoimport-assumption': 'error',
  'nuxt/plugins/no-subdir-auto-registration-assumption': 'error',

  // === Images ===
  'nuxt-image/prefer-nuxtimg': 'warn',
  'nuxt-image/prefer-nuxtpicture-for-formats': 'warn',
  'nuxt-image/prefer-responsive-dimensions': 'warn',
  'nuxt-image/require-alt': 'error',

  // === Scripts (third-party) ===
  'nuxt-scripts/no-raw-third-party-script-tag': 'error',
  'nuxt-scripts/no-third-party-config-script': 'warn',
  'nuxt-scripts/no-third-party-usehead-script': 'warn',

  // === SEO ===
  'nuxt/seo/prefer-seo-composables': 'warn',

  // === Auth ===
  'nuxt-better-auth/require-standard-auth-handler-mount': 'error',

  // === Content / Links ===
  'nuxt-content/links/no-broken-internal-to-link': 'error',
  'nuxt-content/no-querycontent-legacy-api': 'error',

  // === Caching (NuxtHub) ===
  'nuxthub/no-personalized-cached-handler': 'error',
  'nuxthub/prefer-cached-event-handler': 'warn',

  // === Shared code ===
  'nuxt/shared/no-vue-or-nitro-context-in-shared': 'error',
  'nuxt/shared/no-nested-shared-autoimport-assumption': 'error',

  // === Project structure ===
  'nuxt/project/prefer-app-directory-placement': 'warn',

  // === Browser API composables ===
  'vueuse/prefer-use-observers': 'warn',
  'vueuse/prefer-use-scroll-and-element': 'warn',
  'vueuse/prefer-use-storage': 'warn',
  'vueuse/prefer-useclipboard': 'warn',
  'vueuse/prefer-useevent-listener': 'warn',

  // === UI (Nuxt UI consumers only — override to 'off' if not using @nuxt/ui) ===
  'nuxt-ui/prefer-u-button': 'warn',
  'nuxt-ui/prefer-u-form-controls': 'warn',
  'nuxt-ui/require-uapp-root': 'warn',

  // === Vue rules ===
  'vue/style/prefer-props-destructure-defaults': 'warn',
}

export const doctorConfig = {
  config: {
    rules: doctorRules,
  },
}
