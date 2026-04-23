import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('Missing ADMIN_DATABASE_URL or DATABASE_URL for Drizzle')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema/**/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
})
