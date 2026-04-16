
import { createClient } from '@supabase/supabase-js'

// Runtime env (injected by inject-config.sh into window.__ENV__ before main.jsx loads)
// Takes priority over build-time Vite replacements so secrets stay out of the Docker image
const _runtimeEnv = (typeof window !== 'undefined' && window.__ENV__) || {}

const supabaseUrl = _runtimeEnv.VITE_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || ''
const supabaseKey = _runtimeEnv.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Validate configuration
if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration!')
  console.error('Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Railway environment variables')
  throw new Error('Missing Supabase configuration')
}

console.log(`🔌 Connecting to Supabase: ${supabaseUrl}`)
console.log(`🌍 Environment: ${import.meta.env.MODE || 'development'}`)

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  },
  global: {
    headers: {
      'X-Client-Info': 'dogoods-app'
    }
  },
  db: {
    schema: 'public'
  }
})

// Derive the localStorage key Supabase uses for auth tokens
// Format: sb-{project_ref}-auth-token where project_ref is the subdomain
const projectRef = new URL(supabaseUrl).hostname.split('.')[0]
export const SUPABASE_AUTH_KEY = `sb-${projectRef}-auth-token`

export default supabase