import { createUserAgentEnricher, createRequestSizeEnricher } from 'evlog/enrichers'

export default defineNitroPlugin((nitroApp) => {
  const enrichers = [createUserAgentEnricher(), createRequestSizeEnricher()]

  nitroApp.hooks.hook('evlog:enrich', (ctx) => {
    for (const enricher of enrichers) enricher(ctx)
  })
})
