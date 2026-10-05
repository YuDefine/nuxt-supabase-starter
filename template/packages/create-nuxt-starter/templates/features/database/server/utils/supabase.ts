import { createClient } from '@supabase/supabase-js'
import type { H3Event } from 'h3'

export function useServiceRoleClient(event: H3Event) {
  const config = useRuntimeConfig(event)
  return createClient(config.public.supabase.url, config.supabase.secretKey, {
    auth: { persistSession: false },
  })
}
