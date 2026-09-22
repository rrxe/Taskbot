const crypto = require('crypto');
const { supabase, must } = require('../db');

// Verifies the Telegram WebApp `initData` string per Telegram's official spec:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function verifyInitData(initData, botToken) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckArr = [];
  for (const [key, value] of [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    dataCheckArr.push(`${key}=${value}`);
  }
  const dataCheckString = dataCheckArr.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  // optional: reject stale initData (older than 24h)
  const authDate = Number(params.get('auth_date') || 0);
  if (authDate && Date.now() / 1000 - authDate > 86400) return null;

  const userRaw = params.get('user');
  return userRaw ? JSON.parse(userRaw) : null;
}

async function telegramAuth(req, res, next) {
  try {
    const initData = req.header('X-Telegram-Init-Data') || req.body.initData;
    if (!initData) return res.status(401).json({ error: 'missing_init_data' });

    const tgUser = verifyInitData(initData, process.env.BOT_TOKEN);
    if (!tgUser || !tgUser.id) return res.status(401).json({ error: 'invalid_init_data' });

    let user = must(await supabase.from('users').select('*').eq('telegram_id', tgUser.id).maybeSingle());

    if (!user) {
      const ins = await supabase
        .from('users')
        .insert({ telegram_id: tgUser.id, username: tgUser.username || null, first_name: tgUser.first_name || null })
        .select()
        .single();
      if (ins.error && ins.error.code === '23505') {
        // created by a parallel request — just read it
        user = must(await supabase.from('users').select('*').eq('telegram_id', tgUser.id).single());
      } else {
        user = must(ins);
      }
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'account_suspended' });
    }

    req.tgUser = tgUser;
    req.user = user;
    next();
  } catch (err) {
    console.error('telegramAuth error:', err);
    res.status(401).json({ error: 'auth_failed' });
  }
}

module.exports = { telegramAuth, verifyInitData };
