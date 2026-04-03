import { createClient } from '@supabase/supabase-js'

export function useServiceRoleClient() {
  const config = useRuntimeConfig()
  return createClient(config.public.supabase.url, config.supabase.secretKey, {
    auth: { persistSession: false },
  })
}
