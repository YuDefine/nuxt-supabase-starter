import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Nuxt Supabase Starter',
  description: 'Production-ready Nuxt + Supabase starter template',

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/verify/AUTH_INTEGRATION' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Authentication', link: '/guide/auth' },
          { text: 'Database', link: '/guide/database' },
          { text: 'Audit Logging', link: '/guide/audit-logging' },
        ],
      },
      {
        text: 'Architecture',
        items: [
          { text: 'API Patterns', link: '/API_PATTERNS' },
          { text: 'Deployment', link: '/DEPLOYMENT' },
          { text: 'Workflow', link: '/WORKFLOW' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Auth Integration', link: '/verify/AUTH_INTEGRATION' },
          { text: 'Migration Guide', link: '/verify/SUPABASE_MIGRATION_GUIDE' },
          { text: 'RLS Best Practices', link: '/verify/RLS_BEST_PRACTICES' },
          { text: 'API Design Guide', link: '/verify/API_DESIGN_GUIDE' },
          { text: 'Pinia Architecture', link: '/verify/PINIA_ARCHITECTURE' },
          { text: 'Environment Variables', link: '/verify/ENVIRONMENT_VARIABLES' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/YuDefine/nuxt-supabase-starter' }],

    search: {
      provider: 'local',
    },
  },
})
