import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import authMe from './api/auth/me.js'
import tasks from './api/tasks/index.js'
import adPulse from './api/ads/pulse.js'
import withdraw from './api/withdraw.js'
import exchange from './api/exchange.js'
import mining from './api/mining.js'
import subscribe from './api/subscribe.js'
import presence from './api/presence.js'
import gamification from './api/gamification.js'
import admin from './api/admin/index.js'
import { handleTelegramWebhook, setupTelegramWebhook } from './lib/telegram-bot.js'
import { startNotificationScheduler } from './lib/notifications.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', true)
app.disable('x-powered-by')
app.use(compression())
app.use(express.json({ limit: '1mb' }))

const wrap = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    console.error('[Easy Gram] API error:', error)
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Internal server error.' })
  })
}

app.get('/health', (_req, res) => res.status(200).json({ ok: true, app: 'Easy Gram' }))
app.all('/api/auth/me', wrap(authMe))
app.all('/api/tasks', wrap(tasks))
app.all('/api/ads/pulse', wrap(adPulse))
app.all('/api/withdraw', wrap(withdraw))
app.all('/api/exchange', wrap(exchange))
app.all('/api/mining', wrap(mining))
app.all('/api/subscribe', wrap(subscribe))
app.all('/api/presence', wrap(presence))
app.all('/api/gamification', wrap(gamification))
app.all('/api/admin', wrap(admin))
app.post('/api/telegram/webhook', wrap(handleTelegramWebhook))

const distDir = path.join(__dirname, 'dist')
app.use(express.static(distDir, {
  maxAge: '1d',
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  },
}))

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')))
app.get('/admin.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')))
app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' })
  res.sendFile(path.join(distDir, 'index.html'))
})

const port = Number(process.env.PORT || 3000)
app.listen(port, () => {
  console.log(`[Easy Gram] Server running on ${port}`)
  startNotificationScheduler()
  setupTelegramWebhook().catch((error) => console.error('[Easy Gram] Webhook setup failed:', error?.message || error))
})
