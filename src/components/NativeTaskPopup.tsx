import { useEffect, useRef, useState } from 'react'
import { Gift, X } from 'lucide-react'
import '../native-task.css'

type Props = {
  blockId: string
  rewardCoins: number
  lang: 'ar' | 'en'
  onReward: (reward: number, balance: number) => void
}

// AdsGram Task is a native web component. Unlike INT blocks, it does not use
// Adsgram.init(); the Task block is supplied through data-block-id.
const AdsgramTask = 'adsgram-task' as any

function telegramInitData() {
  return (window as any).Telegram?.WebApp?.initData || ''
}

export default function NativeTaskPopup({ blockId, rewardCoins, lang, onReward }: Props) {
  const [visible, setVisible] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const tapCountRef = useRef(0)
  const dismissedRef = useRef(false)
  const taskRef = useRef<HTMLElement | null>(null)
  const claimTimerRef = useRef<number | undefined>(undefined)
  const claimRunningRef = useRef(false)
  const mountedRef = useRef(true)
  const claimRef = useRef<() => void>(() => undefined)
  const onRewardRef = useRef(onReward)
  onRewardRef.current = onReward

  // Keep polling for the server-side Reward URL even if the user closes the
  // popup after completing the task. Only unmounting the app stops this loop.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (claimTimerRef.current !== undefined) window.clearTimeout(claimTimerRef.current)
    }
  }, [])

  claimRef.current = () => {
    if (!mountedRef.current || claimRunningRef.current) return
    claimRunningRef.current = true

    const attemptClaim = (attempt: number) => {
      fetch('/api/auth/me', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `tga ${telegramInitData()}`,
        },
        body: JSON.stringify({ action: 'adsgram_native_task_claim' }),
      })
        .then((response) => response.json())
        .then((data) => {
          if (!mountedRef.current) return
          if (data?.success && !data.pending && typeof data.reward === 'number' && typeof data.balanceCoins === 'number') {
            claimRunningRef.current = false
            dismissedRef.current = true
            setVisible(false)
            onRewardRef.current(data.reward, data.balanceCoins)
            return
          }
          if (attempt < 15) {
            claimTimerRef.current = window.setTimeout(() => attemptClaim(attempt + 1), 2000)
          } else {
            claimRunningRef.current = false
          }
        })
        .catch(() => {
          if (!mountedRef.current) return
          if (attempt < 15) {
            claimTimerRef.current = window.setTimeout(() => attemptClaim(attempt + 1), 2000)
          } else {
            claimRunningRef.current = false
          }
        })
    }

    attemptClaim(0)
  }

  // Show the prompt only after three user taps, once per app session.
  useEffect(() => {
    if (unavailable) return
    const onTap = (event: PointerEvent) => {
      if (dismissedRef.current) return
      const target = event.target as HTMLElement | null
      if (target?.closest?.('.easygram-native-task-popup')) return
      tapCountRef.current += 1
      if (tapCountRef.current >= 3) setVisible(true)
    }
    document.addEventListener('pointerdown', onTap, true)
    return () => document.removeEventListener('pointerdown', onTap, true)
  }, [unavailable])

  const hide = () => {
    dismissedRef.current = true
    setVisible(false)
  }

  useEffect(() => {
    if (!visible) return
    const task = taskRef.current
    if (!task) return

    const onRewardEvent = () => claimRef.current()
    const onUnavailable = () => {
      setUnavailable(true)
      setVisible(false)
    }

    task.addEventListener('reward', onRewardEvent)
    task.addEventListener('onBannerNotFound', onUnavailable)
    task.addEventListener('onTooLongSession', onUnavailable)
    task.addEventListener('onError', onUnavailable)

    return () => {
      task.removeEventListener('reward', onRewardEvent)
      task.removeEventListener('onBannerNotFound', onUnavailable)
      task.removeEventListener('onTooLongSession', onUnavailable)
      task.removeEventListener('onError', onUnavailable)
    }
  }, [visible, blockId])


  if (!visible || unavailable) return null

  const rewardLabel = `${Math.trunc(Number(rewardCoins) || 0).toLocaleString()} COINS`

  return (
    <div className="easygram-native-task-backdrop" role="presentation">
      <section className="easygram-native-task-popup" role="dialog" aria-modal="true" aria-label={lang === 'ar' ? 'مهمة AdsGram' : 'AdsGram task'} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <button type="button" className="easygram-native-task-close" onClick={hide} aria-label={lang === 'ar' ? 'إغلاق' : 'Close'}>
          <X size={18} />
        </button>
        <div className="easygram-native-task-heading">
          <div className="easygram-native-task-icon"><Gift size={22} /></div>
          <div>
            <strong>{lang === 'ar' ? 'مهمة سريعة ومكافأة' : 'Quick task, real reward'}</strong>
            <p>{lang === 'ar' ? 'أكمل المهمة واحصل على مكافأتك مباشرة.' : 'Complete the task to receive your reward.'}</p>
          </div>
        </div>
        <div className="easygram-native-task-reward">
          <span>{lang === 'ar' ? 'المكافأة' : 'YOUR REWARD'}</span>
          <b>+{rewardLabel}</b>
        </div>
        <AdsgramTask
          ref={taskRef}
          data-block-id={blockId}
          data-debug="false"
          data-debug-console="false"
          className="easygram-native-task-widget"
        >
          <span slot="reward" className="easygram-native-task-slot-reward">+{rewardLabel}</span>
          <button slot="button" type="button" className="easygram-native-task-action">
            {lang === 'ar' ? 'عرض المهمة' : 'Open task'}
          </button>
          <button slot="claim" type="button" className="easygram-native-task-action" onClick={() => claimRef.current()}>
            {lang === 'ar' ? 'استلام المكافأة' : 'Claim reward'}
          </button>
          <span slot="done" className="easygram-native-task-done">
            {lang === 'ar' ? 'تم استلام المكافأة' : 'Reward received'}
          </span>
        </AdsgramTask>
        <p className="easygram-native-task-footnote">
          {lang === 'ar' ? 'تقدر تغلق النافذة وتكمل استخدام التطبيق.' : 'You can close this popup and keep using the app.'}
        </p>
      </section>
    </div>
  )
}
