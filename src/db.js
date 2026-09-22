const { createClient } = require('@supabase/supabase-js');

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !key) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
  console.warn(`[supabase] SUPABASE_URL looks unusual: "${url}" (expected https://<project-ref>.supabase.co)`);
}

// Backend-only client: uses the service_role key (bypasses RLS). Never expose it to the browser.
const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Unwraps a supabase-js response: throws on error, returns data.
function must(res) {
  if (res.error) {
    const err = new Error(res.error.message || 'database_error');
    err.code = res.error.code;
    err.details = res.error.details;
    throw err;
  }
  return res.data;
}

// Calls a Postgres function defined in sql/schema.sql.
async function rpc(name, args) {
  return must(await supabase.rpc(name, args || {}));
}

module.exports = { supabase, must, rpc };
