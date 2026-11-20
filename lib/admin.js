import crypto from 'node:crypto'
import { authenticateRequest } from './telegram-auth.js'
import { supabase } from './supabase.js'

export const ADMIN_PERMISSIONS = [
  'dashboard', 'tasks', 'withdrawals', 'settings', 'moderators', 'broadcast', 'users', 'subscriptions',
]

function safeSecretMatch(provided, expected) {
  if (!provided || !expected) return false
  const a = Buffer.from(String(provided), 'utf8')
  const b = Buffer.from(String(expected), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export async function requireAdmin(req, res, permission = 'dashboard') {
  // Main owner signs into /admin with the same ADMIN_SECRET method used by SLY.
  const providedSecret = String(req.headers['x-admin-secret'] || '')
  const expectedSecret = String(process.env.ADMIN_SECRET || '')
  if (safeSecretMatch(providedSecret, expectedSecret)) {
    const telegramActor = authenticateRequest(req)
    const actor = telegramActor || {
      id: 'admin_secret_owner',
      username: 'owner',
      firstName: 'Easy Gram Owner',
    }
    const admin = {
      telegram_id: 'ADMIN_SECRET_OWNER',
      username: actor.username || 'owner',
      first_name: actor.firstName || 'Easy Gram Owner',
      role: 'owner',
      permissions: ADMIN_PERMISSIONS,
    }
    return { actor, admin }
  }

  // Moderators still authenticate with their own signed Telegram Mini App data.
  const actor = authenticateRequest(req)
  if (!actor) {
    res.status(401).json({ success: false, error: 'Enter ADMIN_SECRET or open Easy Gram inside Telegram as an authorized moderator.' })
    return null
  }

  const { data: admin, error } = await supabase
    .from('easygram_admins')
    .select('telegram_id,username,first_name,role,permissions')
    .eq('telegram_id', actor.id)
    .maybeSingle()

  if (error) throw error
  if (!admin) {
    res.status(403).json({ success: false, error: 'Admin access required.' })
    return null
  }

  const perms = Array.isArray(admin.permissions) ? admin.permissions : []
  if (admin.role !== 'owner' && permission !== 'dashboard' && !perms.includes(permission)) {
    res.status(403).json({ success: false, error: 'You do not have permission for this section.' })
    return null
  }

  return { actor, admin }
}

export function isOwner(admin) {
  return admin?.role === 'owner'
}
