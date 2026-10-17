import { createClient } from '@supabase/supabase-js'

const env = import.meta.env
const url = env.VITE_SUPABASE_URL?.trim() ?? ''
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

const missingEnvVars = [
  !url && 'VITE_SUPABASE_URL',
  !publishableKey && 'VITE_SUPABASE_PUBLISHABLE_KEY',
].filter(Boolean)

let validUrl = false
if (url) {
  try {
    validUrl = new URL(url).protocol === 'https:'
  } catch {
    validUrl = false
  }
}

export const supabaseConfig = {
  hasRequiredConfig: missingEnvVars.length === 0 && validUrl,
  missingEnvVars,
  invalidUrl: Boolean(url) && !validUrl,
}

export const supabase = supabaseConfig.hasRequiredConfig
  ? createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null
