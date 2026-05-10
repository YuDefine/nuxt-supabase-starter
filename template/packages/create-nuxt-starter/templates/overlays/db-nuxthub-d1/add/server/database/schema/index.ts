import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const exampleItems = sqliteTable('example_items', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export type ExampleItem = typeof exampleItems.$inferSelect
export type NewExampleItem = typeof exampleItems.$inferInsert
