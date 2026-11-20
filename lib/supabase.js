import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('[Easy Gram] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

export const supabase = createClient(url || 'https://example.supabase.co', key || 'missing-service-role-key', {
  auth: { persistSession: false, autoRefreshToken: false },
})
