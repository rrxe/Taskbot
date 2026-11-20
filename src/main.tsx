import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './easy-theme.css'

const telegram = (window as any).Telegram?.WebApp
try {
  telegram?.ready?.()
  telegram?.expand?.()
  telegram?.setHeaderColor?.('#FFFDF7')
  telegram?.setBackgroundColor?.('#F4F6EF')
} catch { /* Telegram SDK is optional during local preview */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
