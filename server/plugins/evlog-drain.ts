import type { DrainContext } from 'evlog'
import { createDrainPipeline } from 'evlog/pipeline'
import { createSentryDrain } from 'evlog/sentry'

export default defineNitroPlugin((nitroApp) => {
  const pipeline = createDrainPipeline<DrainContext>()
  const drain = pipeline(createSentryDrain())

  nitroApp.hooks.hook('evlog:drain', drain)
  nitroApp.hooks.hook('close', () => drain.flush())
})
