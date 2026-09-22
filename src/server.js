require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const { supabase } = require('./db');
const publicApi = require('./routes/publicApi');
const adminApi = require('./routes/adminApi');
const { createBot } = require('./bot');

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

// ---- Mini App (user-facing) ----
app.use('/', express.static(path.join(__dirname, '..', 'public')));

// ---- Admin panel (static SPA, protected client-side by password/JWT) ----
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));

// ---- APIs ----
app.use('/api', publicApi);
app.use('/admin/api', adminApi);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;

// ---- Error handler (must be after all routes) ----
app.use((err, req, res, next) => {
  console.error('Request error:', err.message);
  if (err.code === '23505') return res.status(409).json({ error: 'already_exists' });
  if (err.code === '23503') return res.status(409).json({ error: 'in_use' });
  res.status(500).json({ error: 'server_error' });
});

async function start() {
  // Connectivity / schema check (schema.sql is run once in Supabase SQL Editor)
  const { error } = await supabase.from('settings').select('key').limit(1);
  if (error) {
    console.error(
      `Supabase check FAILED: ${error.message}\n` +
        '-> Verify SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, and that sql/schema.sql was run in Supabase SQL Editor.'
    );
  } else {
    console.log('Supabase connection OK.');
  }

  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  if (process.env.BOT_TOKEN) {
    const bot = createBot();
    bot.launch();
    console.log('Telegram bot started (polling mode).');
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
  } else {
    console.warn('BOT_TOKEN not set — bot not started.');
  }
}

start();
