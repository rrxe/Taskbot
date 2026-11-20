import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowRight, Award, Brain, CalendarCheck, Check, CheckCircle2, Clock3, Flame,
  Gamepad2, Gift, LockKeyhole, Medal, MousePointer2, Sparkles, Target, Ticket,
  Trophy, Zap, Calculator,
} from 'lucide-react'
import './earn-hub.css'

type Lang = 'ar' | 'en'
type HubTab = 'games' | 'daily' | 'codes' | 'leaderboard'
type GameId = 'orbit' | 'memory' | 'reactor' | 'pulse' | 'math'
type HubSnapshot = {
  success: boolean
  balance: number
  daily: {
    streak: number
    lastClaim: string | null
    canClaim: boolean
    rewards: number[]
    history: Array<{ checkin_date: string; streak: number; reward_coins: number }>
  }
  games: {
    attemptsUsed: number
    freeAttempts: number
    bonusAttempts: number
    bonusLimit: number
    attemptsLimit: number
    minDurationSeconds: number
    rewards: Record<GameId, number>
    recent: Array<{ id: string; game_id: GameId; score: number; reward_coins: number; finished_at: string }>
    leaderboard: Array<{ key: string; name: string; score: number; coins: number; games: number }>
  }
}
type ActiveRun = { id: string; gameId: GameId; startedAt: number }
type MathQuestion = { label: string; answer: number; options: number[] }

const strings = {
  en: {
    eyebrow: 'EASY GRAM / REWARDS LAB', title: 'Arcade & rewards', subtitle: 'Play smart. Keep your streak. Earn more Coins.',
    games: 'Games', daily: 'Daily', codes: 'Gift codes', leaderboard: 'Leaderboard',
    available: 'Attempts available today', reward: 'Reward', play: 'Play now', playing: 'Game in progress',
    noAttempts: 'You have used today’s game attempts. Watch an ad for another try or return after the daily reset.',
    orbit: 'Orbit Dash', orbitDesc: 'Track the signal and hit the glowing tile at least 8 times before the round ends.',
    memory: 'Memory Matrix', memoryDesc: 'Flip the cards, remember each symbol and uncover all four matching pairs.',
    reactor: 'Reactor Rush', reactorDesc: 'Charge the core with quick taps and reach 18 hits before the countdown ends.',
    pulse: 'Pulse Reaction', pulseDesc: 'Wait for the signal to turn green, then tap fast. Complete five reaction rounds.',
    math: 'Math Sprint', mathDesc: 'Solve six quick equations. Choose the right answer before the clock runs out.',
    dailyTitle: 'Your daily streak', dailyDesc: 'Come back every day to keep your streak alive and unlock the seven-day reward path.',
    claimDaily: 'Claim today’s bonus', claimed: 'Claimed today', nextReward: 'Next reward', day: 'Day', streak: 'day streak',
    codeTitle: 'Redeem a gift code', codeDesc: 'Enter a code shared by the Easy Gram team. Valid rewards are credited directly to your Coin balance.',
    codePlaceholder: 'ENTER GIFT CODE', redeem: 'Redeem code', redeeming: 'Redeeming…',
    codeSuccess: 'Gift code redeemed', alreadyClaimed: 'You have already claimed today’s reward.',
    leaderTitle: 'Weekly leaderboard', leaderDesc: 'Top players by total mini-game score in the last seven days.',
    noLeaders: 'No completed games yet. Be the first to claim a place on the board.', rank: 'Rank', player: 'Player', score: 'Score',
    gamesPlayed: 'games', coins: 'Coins', recentRuns: 'Your recent games', noRuns: 'Your completed games will appear here.',
    loading: 'Loading rewards…', error: 'Could not load rewards.',
    start: 'Start run', timeLeft: 'Time left', hits: 'Hits', taps: 'Taps', pairs: 'Pairs found',
    tapSignal: 'TAP THE SIGNAL', hitSignal: 'SIGNAL HIT', targetTip: 'Tap the glowing tile only.',
    tapFast: 'TAP TO CHARGE', reactorTip: 'Reach 18 taps before the timer ends.',
    solveTip: 'Match all four pairs. Your reward is checked by the server.',
    claimReward: 'Claim game reward', claiming: 'Verifying…', exit: 'Exit game',
    needMore: 'Target not reached. This attempt has been used.', gameWon: 'Challenge complete. Great run!',
    gameFailed: 'Time is up. Try another round.', successReward: 'Reward added to your wallet!',
    minTime: 'Your score is ready. Hold on until the verification timer completes.', sessionChecking: 'Checking your game result…',
    checkinReward: 'Today’s bonus', dayRewards: 'Seven-day reward path',
    today: 'Today', completed: 'Claimed', locked: 'Locked', unlocked: 'Ready',
    invalidCode: 'Check the code and try again.', gameNote: 'Free attempts are shared across every game.',
    freeAttempts: 'Free', bonusAttempts: 'From ads', watchAdBonus: 'Watch an ad · +1 attempt',
    watchingAd: 'Opening reward ad…', bonusLimitReached: 'You reached today’s ad-attempt limit.',
    bonusHint: 'Each verified ad adds one attempt. Daily limit:',
    waitForGreen: 'Wait for the signal…', tapNow: 'TAP NOW!', tooSoon: 'Too early — wait for green.',
    reactionProgress: 'Successful reactions', mathProgress: 'Correct answers', chooseAnswer: 'Choose the correct answer',
    correct: 'Correct!', notQuite: 'Not quite. Try this one.', points: 'points', checkYourNetwork: 'Check your connection and refresh.',
    featured: 'Top players this week', viewAll: 'View leaderboard', quickGift: 'Have a gift code?', quickGiftDesc: 'Redeem it for bonus Coins.', openCodes: 'Enter code', noPreviewLeaders: 'Play a game to appear here.',
  },
  ar: {
    eyebrow: 'EASY GRAM / مختبر المكافآت', title: 'الألعاب والمكافآت', subtitle: 'العب بذكاء، حافظ على سلسلتك، واجمع Coins أكثر.',
    games: 'الألعاب', daily: 'اليومي', codes: 'أكواد الهدايا', leaderboard: 'المتصدرون',
    available: 'المحاولات المتاحة اليوم', reward: 'المكافأة', play: 'العب الآن', playing: 'اللعبة جارية',
    noAttempts: 'استخدمت محاولات اليوم. شاهد إعلاناً لتحصل على محاولة إضافية أو عد بعد التصفير اليومي.',
    orbit: 'مطاردة المدار', orbitDesc: 'تتبّع الإشارة واضغط المربع المضيء 8 مرات على الأقل قبل انتهاء الجولة.',
    memory: 'مصفوفة الذاكرة', memoryDesc: 'اقلب البطاقات وتذكّر الرموز واعثر على الأزواج الأربعة المتطابقة.',
    reactor: 'اندفاع المفاعل', reactorDesc: 'اشحن النواة بالضغط السريع وحقق 18 ضغطة قبل انتهاء المؤقت.',
    pulse: 'ردّة الفعل', pulseDesc: 'انتظر حتى تتحول الإشارة إلى الأخضر ثم اضغط بسرعة. أكمل خمس جولات.',
    math: 'تحدي الحساب', mathDesc: 'حل ست مسائل سريعة واختر الإجابة الصحيحة قبل انتهاء الوقت.',
    dailyTitle: 'سلسلتك اليومية', dailyDesc: 'عد كل يوم للمحافظة على سلسلتك وفتح مسار مكافآت الأيام السبعة.',
    claimDaily: 'استلام مكافأة اليوم', claimed: 'تم الاستلام اليوم', nextReward: 'المكافأة التالية', day: 'اليوم', streak: 'أيام متتالية',
    codeTitle: 'استخدم كود الهدية', codeDesc: 'أدخل كوداً من فريق Easy Gram وستضاف المكافأة الصالحة مباشرة إلى رصيد Coins.',
    codePlaceholder: 'أدخل كود الهدية', redeem: 'تفعيل الكود', redeeming: 'جارٍ التفعيل…',
    codeSuccess: 'تم تفعيل كود الهدية', alreadyClaimed: 'استلمت مكافأة اليوم بالفعل.',
    leaderTitle: 'ترتيب الأسبوع', leaderDesc: 'أفضل اللاعبين حسب مجموع نقاط الألعاب خلال آخر سبعة أيام.',
    noLeaders: 'لا توجد ألعاب مكتملة حتى الآن. كن أول من يظهر في قائمة المتصدرين.', rank: 'الترتيب', player: 'اللاعب', score: 'النقاط',
    gamesPlayed: 'ألعاب', coins: 'Coins', recentRuns: 'ألعابك الأخيرة', noRuns: 'ستظهر الألعاب المكتملة هنا.',
    loading: 'جارٍ تحميل المكافآت…', error: 'تعذر تحميل المكافآت.',
    start: 'ابدأ الجولة', timeLeft: 'المتبقي', hits: 'الإصابات', taps: 'الضغطات', pairs: 'الأزواج المكتشفة',
    tapSignal: 'اضغط الإشارة', hitSignal: 'إصابة ناجحة', targetTip: 'اضغط المربع المضيء فقط.',
    tapFast: 'اضغط للشحن', reactorTip: 'تحتاج إلى 18 ضغطة قبل انتهاء الوقت.',
    solveTip: 'طابق الأزواج الأربعة. يتم التحقق من المكافأة عبر الخادم.',
    claimReward: 'استلام مكافأة اللعبة', claiming: 'جارٍ التحقق…', exit: 'الخروج من اللعبة',
    needMore: 'لم تحقق النتيجة المطلوبة. تم استهلاك المحاولة.', gameWon: 'اكتمل التحدي. أحسنت!',
    gameFailed: 'انتهى الوقت. جرّب جولة أخرى.', successReward: 'تمت إضافة المكافأة إلى محفظتك!',
    minTime: 'نتيجتك جاهزة. انتظر اكتمال مؤقت التحقق.', sessionChecking: 'جارٍ التحقق من نتيجة اللعبة…',
    checkinReward: 'مكافأة اليوم', dayRewards: 'مسار مكافآت سبعة أيام',
    today: 'اليوم', completed: 'تم', locked: 'مقفل', unlocked: 'جاهز',
    invalidCode: 'تحقق من الكود وحاول مرة أخرى.', gameNote: 'المحاولات المجانية مشتركة بين جميع الألعاب.',
    freeAttempts: 'مجانية', bonusAttempts: 'من الإعلانات', watchAdBonus: 'شاهد إعلاناً · +1 محاولة',
    watchingAd: 'جارٍ فتح إعلان المكافأة…', bonusLimitReached: 'وصلت إلى الحد اليومي لمحاولات الإعلانات.',
    bonusHint: 'كل إعلان موثّق يمنحك محاولة واحدة. الحد اليومي:',
    waitForGreen: 'انتظر الإشارة…', tapNow: 'اضغط الآن!', tooSoon: 'مبكر جداً — انتظر اللون الأخضر.',
    reactionProgress: 'ردّات الفعل الناجحة', mathProgress: 'الإجابات الصحيحة', chooseAnswer: 'اختر الإجابة الصحيحة',
    correct: 'صحيح!', notQuite: 'ليست صحيحة. جرّب المسألة التالية.', points: 'نقاط', checkYourNetwork: 'تحقق من الاتصال ثم حدّث الصفحة.',
    featured: 'أفضل اللاعبين هذا الأسبوع', viewAll: 'عرض الترتيب', quickGift: 'لديك كود هدية؟', quickGiftDesc: 'استخدمه لتحصل على Coins إضافية.', openCodes: 'إدخال الكود', noPreviewLeaders: 'العب إحدى الألعاب لتظهر هنا.',
  },
}

function gamificationError(error: unknown, lang: Lang, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  if (lang !== 'ar') return message
  const translations: Array<[RegExp, string]> = [
    [/Daily reward already claimed/i, 'استلمت مكافأة التسجيل اليوم بالفعل.'],
    [/Invalid or inactive gift code/i, 'كود الهدية غير صحيح أو غير مفعّل.'],
    [/gift code has expired/i, 'انتهت صلاحية كود الهدية.'],
    [/usage limit/i, 'وصل كود الهدية إلى الحد الأقصى للاستخدام.'],
    [/already used/i, 'استخدمت هذا الكود من قبل.'],
    [/Daily game attempts/i, 'انتهت محاولات الألعاب المتاحة لهذا اليوم.'],
    [/Play the game/i, 'أكمل مدة اللعب المطلوبة قبل استلام المكافأة.'],
    [/Target score|matching pairs|Reactor score|reaction rounds|math questions/i, 'لم تحقق النتيجة المطلوبة في هذه الجولة.'],
    [/bonus game attempt|game reward ad/i, 'تعذر إضافة المحاولة. شاهد إعلان المكافأة مرة أخرى.'],
    [/temporarily disabled/i, 'هذه اللعبة متوقفة مؤقتاً.'],
    [/suspended/i, 'هذا الحساب موقوف.'],
    [/Open Easy Gram inside Telegram/i, 'افتح Easy Gram من داخل تطبيق تيليجرام.'],
  ]
  return translations.find(([pattern]) => pattern.test(message))?.[1] || message
}

async function gamificationRequest<T>(body?: Record<string, unknown>): Promise<T> {
  const initData = (window as any).Telegram?.WebApp?.initData || ''
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (initData) {
    headers.Authorization = `tga ${initData}`
    headers['X-Telegram-Init-Data'] = initData
  }
  const response = await fetch('/api/gamification', {
    method: body ? 'POST' : 'GET', headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data as T
}

const gameMeta: Array<{ id: GameId; icon: typeof Target; theme: string; index: string }> = [
  { id: 'orbit', icon: Target, theme: 'orbit', index: '01' },
  { id: 'memory', icon: Brain, theme: 'memory', index: '02' },
  { id: 'reactor', icon: Zap, theme: 'reactor', index: '03' },
  { id: 'pulse', icon: MousePointer2, theme: 'pulse', index: '04' },
  { id: 'math', icon: Calculator, theme: 'math', index: '05' },
]

export function HomeRewardsPreview({ lang, onOpenTab }: {
  lang: Lang
  onOpenTab: (tab: HubTab) => void
}) {
  const t = strings[lang]
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    gamificationRequest<HubSnapshot>()
      .then((data) => { if (active) setSnapshot(data) })
      .catch(() => { if (active) setSnapshot(null) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  return <section className="home-rewards-preview">
    <div className="home-rewards-heading">
      <div><span className="eyebrow">EASY GRAM / WEEKLY</span><h2>{t.featured}</h2></div>
      <button type="button" onClick={() => onOpenTab('leaderboard')}>{t.viewAll}<ArrowRight size={15} /></button>
    </div>
    <div className="home-rewards-grid">
      <div className="home-leaderboard-card">
        {loading ? <div className="home-rewards-loading"><span className="spinner" /></div> : snapshot?.games.leaderboard.length ? snapshot.games.leaderboard.slice(0, 3).map((player, index) =>
          <div className={`home-leader-row rank-${index + 1}`} key={player.key}>
            <span className="home-leader-rank">{index + 1}</span>
            <span className="home-leader-name">{player.name}</span>
            <b>{player.score.toLocaleString()}</b>
          </div>
        ) : <div className="home-leader-empty"><Trophy size={18} /><span>{t.noPreviewLeaders}</span></div>}
        <button className="home-leader-footer" type="button" onClick={() => onOpenTab('leaderboard')}>{t.viewAll}<ArrowRight size={14} /></button>
      </div>
      <button className="home-gift-shortcut" type="button" onClick={() => onOpenTab('codes')}>
        <span className="home-gift-icon"><Gift size={20} /></span>
        <span className="home-gift-copy"><b>{t.quickGift}</b><small>{t.quickGiftDesc}</small></span>
        <span className="home-gift-action">{t.openCodes}<ArrowRight size={14} /></span>
      </button>
    </div>
  </section>
}

export default function EarnHub({ lang, onBalance, onNotify, initialTab = 'games', onWatchBonusAd }: {
  lang: Lang
  onBalance: (balance: number) => void
  onNotify: (message: string) => void
  initialTab?: HubTab
  onWatchBonusAd: () => Promise<unknown>
}) {
  const t = strings[lang]
  const [tab, setTab] = useState<HubTab>(initialTab)
  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [bonusBusy, setBonusBusy] = useState(false)
  const [code, setCode] = useState('')
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null)
  const [resultMessage, setResultMessage] = useState('')
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await gamificationRequest<HubSnapshot>()
      setSnapshot(data)
      onBalance(data.balance)
    } catch (error) {
      notifyRef.current(gamificationError(error, lang, t.error))
    } finally {
      setLoading(false)
    }
  }, [onBalance, lang, t.error])

  useEffect(() => { void loadSnapshot() }, [loadSnapshot])

  const claimDaily = async () => {
    if (busy || !snapshot?.daily.canClaim) return
    setBusy(true)
    try {
      const data = await gamificationRequest<{ reward: number; streak: number; balance: number }>({ action: 'checkin' })
      onBalance(data.balance)
      await loadSnapshot()
      notifyRef.current(lang === 'ar'
        ? `تم استلام ${Number(data.reward).toLocaleString()} Coins · اليوم ${data.streak}`
        : `Claimed ${Number(data.reward).toLocaleString()} Coins · Day ${data.streak}`)
    } catch (error) {
      notifyRef.current(gamificationError(error, lang, t.error))
    } finally { setBusy(false) }
  }

  const redeemCode = async () => {
    if (busy || !code.trim()) return
    setBusy(true)
    try {
      const data = await gamificationRequest<{ reward: number; balance: number }>({ action: 'redeem_code', code })
      onBalance(data.balance)
      setCode('')
      setResultMessage(`${t.codeSuccess}: +${Number(data.reward).toLocaleString()} COINS`)
      notifyRef.current(`${t.codeSuccess} · +${Number(data.reward).toLocaleString()} COINS`)
      await loadSnapshot()
    } catch (error) {
      notifyRef.current(gamificationError(error, lang, t.invalidCode))
    } finally { setBusy(false) }
  }

  const startGame = async (gameId: GameId) => {
    if (busy || !snapshot || snapshot.games.attemptsUsed >= snapshot.games.attemptsLimit) return
    setBusy(true)
    setResultMessage('')
    try {
      const data = await gamificationRequest<{ runId: string }>({ action: 'start_game', gameId })
      setActiveRun({ id: data.runId, gameId, startedAt: Date.now() })
      await loadSnapshot()
    } catch (error) {
      notifyRef.current(gamificationError(error, lang, t.error))
      await loadSnapshot()
    } finally { setBusy(false) }
  }

  const finishGame = async (score: number) => {
    if (!activeRun || busy) return
    setBusy(true)
    try {
      const data = await gamificationRequest<{ reward: number; balance: number }>({
        action: 'finish_game', runId: activeRun.id, score,
      })
      setActiveRun(null)
      setResultMessage(`${t.successReward} +${Number(data.reward).toLocaleString()} COINS`)
      onBalance(data.balance)
      await loadSnapshot()
      notifyRef.current(`${t.successReward} +${Number(data.reward).toLocaleString()} COINS`)
    } catch (error) {
      setActiveRun(null)
      notifyRef.current(gamificationError(error, lang, t.error))
      await loadSnapshot()
    } finally { setBusy(false) }
  }

  const watchBonusAd = async () => {
    if (bonusBusy || !snapshot || snapshot.games.bonusAttempts >= snapshot.games.bonusLimit) return
    setBonusBusy(true)
    try {
      await onWatchBonusAd()
      await loadSnapshot()
    } catch (error) {
      notifyRef.current(gamificationError(error, lang, t.error))
    } finally { setBonusBusy(false) }
  }

  const attemptsLeft = snapshot ? Math.max(0, snapshot.games.attemptsLimit - snapshot.games.attemptsUsed) : 0
  const nextCheckinReward = snapshot?.daily.rewards[((snapshot.daily.streak || 0) % 7)] || snapshot?.daily.rewards[0] || 0
  const bonusCapReached = !!snapshot && snapshot.games.bonusAttempts >= snapshot.games.bonusLimit

  return <div className="earn-hub" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
    <div className="earn-hub-heading">
      <div>
        <p className="eyebrow">{t.eyebrow}</p>
        <h1>{t.title}</h1>
        <p>{t.subtitle}</p>
      </div>
      <div className="earn-hub-emblem"><Gamepad2 size={24} /></div>
    </div>

    <div className="earn-hub-tabs" role="tablist" aria-label={t.title}>
      {([
        ['games', Gamepad2, t.games], ['daily', CalendarCheck, t.daily], ['codes', Ticket, t.codes], ['leaderboard', Trophy, t.leaderboard],
      ] as const).map(([id, Icon, label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} role="tab" aria-selected={tab === id}>
        <Icon size={16} /><span>{label}</span>
      </button>)}
    </div>

    {loading && <div className="earn-hub-loading"><span className="spinner" /> {t.loading}</div>}

    {!loading && !snapshot && <div className="earn-hub-error"><Sparkles size={22} /><p>{t.error}</p><button type="button" onClick={() => { setLoading(true); void loadSnapshot() }}>{lang === 'ar' ? 'إعادة المحاولة' : 'Try again'}</button></div>}

    {!loading && snapshot && <>
      {tab === 'games' && <>
        <section className="arcade-status-card">
          <div className="arcade-status-copy">
            <span>{t.available}</span>
            <strong>{attemptsLeft}<small> / {snapshot.games.attemptsLimit}</small></strong>
            <div className="attempt-breakdown"><span>{t.freeAttempts}: {snapshot.games.freeAttempts}</span><i /> <span>{t.bonusAttempts}: {snapshot.games.bonusAttempts}</span></div>
          </div>
          <div className="attempt-ring" style={{ '--attempt-progress': `${(snapshot.games.attemptsUsed / Math.max(1, snapshot.games.attemptsLimit)) * 100}%` } as CSSProperties}><Gamepad2 size={22} /></div>
        </section>
        <div className="game-ad-reward-card">
          <div className="game-ad-reward-icon"><Gift size={19} /></div>
          <div className="game-ad-reward-copy"><b>{t.watchAdBonus}</b><small>{t.bonusHint} {snapshot.games.bonusLimit}</small></div>
          <button type="button" onClick={() => void watchBonusAd()} disabled={bonusBusy || bonusCapReached}>
            {bonusBusy ? <span className="spinner light" /> : <span className="ad-play-mark">▶</span>}
            {bonusBusy ? t.watchingAd : bonusCapReached ? t.bonusLimitReached : '+1'}
          </button>
        </div>
        {resultMessage && <div className="earn-result"><CheckCircle2 size={17} />{resultMessage}</div>}
        {activeRun ? <ActiveGame
          key={activeRun.id}
          gameId={activeRun.gameId}
          minDuration={snapshot.games.minDurationSeconds}
          busy={busy}
          t={t}
          onClaim={(score) => void finishGame(score)}
          onExit={() => {
            setActiveRun(null)
            notifyRef.current(lang === 'ar' ? 'تم إنهاء الجولة؛ احتُسبت محاولة اليوم.' : 'Run closed. This daily attempt has been used.')
            void loadSnapshot()
          }}
        /> : <div className="arcade-grid">
          {gameMeta.map(({ id, icon: Icon, theme, index }) => {
            const reward = snapshot.games.rewards[id]
            const name = t[id]
            const description = t[`${id}Desc` as keyof typeof t]
            return <article className={`arcade-game-card ${theme}`} key={id}>
              <div className="arcade-game-art">
                <span className="game-card-index">{index}</span>
                <div className="game-art-orbit orbit-one" /><div className="game-art-orbit orbit-two" />
                <span className="game-art-icon"><Icon size={28} strokeWidth={1.8} /></span>
                <i /><i /><i />
              </div>
              <div className="arcade-game-info">
                <div className="arcade-game-copy"><h3>{name}</h3><p>{description}</p></div>
                <div className="arcade-game-reward"><span>{t.reward}</span><b>+{reward.toLocaleString()}</b><small>COINS</small></div>
              </div>
              <button type="button" className="arcade-play-btn" disabled={busy || attemptsLeft <= 0 || reward <= 0} onClick={() => void startGame(id)}>
                {busy ? <span className="spinner light" /> : <Gamepad2 size={16} />}{t.play}<ArrowRight size={15} />
              </button>
            </article>
          })}
        </div>}
        {attemptsLeft <= 0 && !activeRun && <p className="arcade-empty-note">{t.noAttempts}</p>}
        {snapshot.games.recent.length > 0 && <section className="arcade-recent">
          <div className="arcade-section-title"><h2>{t.recentRuns}</h2><Award size={17} /></div>
          {snapshot.games.recent.map((run) => <div className="arcade-recent-row" key={run.id}><span>{t[run.game_id]}</span><b>{run.score} {t.score}</b><strong>+{run.reward_coins.toLocaleString()}</strong></div>)}
        </section>}
      </>}

      {tab === 'daily' && <section className="daily-reward-panel">
        <div className="daily-panel-top"><div className="daily-icon"><Flame size={23} /></div><div><p className="eyebrow">{t.dailyTitle}</p><h2>{snapshot.daily.streak} {t.streak}</h2><p>{t.dailyDesc}</p></div></div>
        <div className="daily-path-title"><span>{t.dayRewards}</span><small>{t.nextReward}: +{nextCheckinReward.toLocaleString()}</small></div>
        <div className="daily-reward-path">
          {snapshot.daily.rewards.slice(0, 7).map((reward, index) => {
            const day = index + 1
            const streak = Math.max(0, Number(snapshot.daily.streak) || 0)
            const lastClaim = snapshot.daily.lastClaim
            const cycleStart = lastClaim ? new Date(`${lastClaim}T00:00:00.000Z`) : null
            if (cycleStart) cycleStart.setUTCDate(cycleStart.getUTCDate() - Math.max(0, streak - 1))
            const cycleStartDate = cycleStart ? cycleStart.toISOString().slice(0, 10) : ''
            const claimedDays = snapshot.daily.history
              .filter((item) => !!lastClaim && item.checkin_date >= cycleStartDate && item.checkin_date <= lastClaim)
              .map((item) => ((Math.max(1, Number(item.streak)) - 1) % 7) + 1)
            const claimed = claimedDays.includes(day)
            const currentDay = (streak % 7) || 0
            return <div className={`daily-reward-day ${claimed ? 'claimed' : currentDay === index && !snapshot.daily.canClaim ? 'current' : ''}`} key={day}>
              <span>{claimed ? <Check size={13} /> : day}</span><b>+{Number(reward).toLocaleString()}</b><small>{t.day} {day}</small>
            </div>
          })}
        </div>
        <div className="daily-bonus-line"><div><span>{t.checkinReward}</span><strong>+{Number(nextCheckinReward).toLocaleString()} COINS</strong></div><div className="daily-last-claim">{snapshot.daily.lastClaim ? `${t.today}: ${snapshot.daily.lastClaim}` : t.unlocked}</div></div>
        <button type="button" className={`daily-claim-btn ${!snapshot.daily.canClaim ? 'claimed' : ''}`} disabled={busy || !snapshot.daily.canClaim} onClick={() => void claimDaily()}>
          {busy ? <span className="spinner light" /> : snapshot.daily.canClaim ? <CalendarCheck size={17} /> : <CheckCircle2 size={17} />}
          {snapshot.daily.canClaim ? t.claimDaily : t.claimed}
        </button>
        <div className="daily-history"><h3>{lang === 'ar' ? 'آخر التسجيلات' : 'Recent check-ins'}</h3>{snapshot.daily.history.length === 0 ? <p>{lang === 'ar' ? 'سجّل اليوم لتبدأ سلسلتك.' : 'Claim today to start your streak.'}</p> : snapshot.daily.history.slice(0, 5).map((item) => <div key={item.checkin_date}><span>{item.checkin_date}</span><b>+{Number(item.reward_coins).toLocaleString()} COINS</b></div>)}</div>
      </section>}

      {tab === 'codes' && <section className="gift-code-panel">
        <div className="gift-code-art"><div><Gift size={29} /></div><span /><span /><span /></div>
        <p className="eyebrow">EASY GRAM EXCLUSIVE</p><h2>{t.codeTitle}</h2><p>{t.codeDesc}</p>
        <form className="gift-code-form" onSubmit={(event) => { event.preventDefault(); void redeemCode() }}>
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/\s+/g, ''))} placeholder={t.codePlaceholder} autoCapitalize="characters" maxLength={32} aria-label={t.codePlaceholder} />
          <button disabled={busy || !code.trim()}>{busy ? <span className="spinner light" /> : <Ticket size={17} />}{busy ? t.redeeming : t.redeem}</button>
        </form>
        {resultMessage && <div className="earn-result"><CheckCircle2 size={17} />{resultMessage}</div>}
        <div className="gift-code-foot"><LockKeyhole size={14} /><span>{lang === 'ar' ? 'كل كود صالح للاستخدام مرة واحدة لكل حساب، وقد تكون له حدود استخدام أو تاريخ انتهاء.' : 'Each code can be used once per account and may have usage limits or an expiry date.'}</span></div>
      </section>}

      {tab === 'leaderboard' && <section className="leaderboard-panel">
        <div className="leaderboard-heading"><div className="leaderboard-icon"><Trophy size={23} /></div><div><h2>{t.leaderTitle}</h2><p>{t.leaderDesc}</p></div></div>
        {snapshot.games.leaderboard.length === 0 ? <div className="leaderboard-empty"><Medal size={28} /><p>{t.noLeaders}</p></div> : <div className="leaderboard-list">
          {snapshot.games.leaderboard.map((player, index) => <div className={`leaderboard-row rank-${index + 1}`} key={player.key}>
            <span className="leader-rank">{index < 3 ? <Trophy size={15} /> : index + 1}</span>
            <div className="leader-player"><strong>{player.name}</strong><small>{player.games} {t.gamesPlayed}</small></div>
            <div className="leader-score"><b>{player.score.toLocaleString()}</b><small>{t.score}</small></div>
          </div>)}
        </div>}
      </section>}
    </>}
  </div>
}

function ActiveGame({ gameId, minDuration, busy, t, onClaim, onExit }: {
  gameId: GameId
  minDuration: number
  busy: boolean
  t: typeof strings.en
  onClaim: (score: number) => void
  onExit: () => void
}) {
  const startAt = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const [target, setTarget] = useState(4)
  const [orbitScore, setOrbitScore] = useState(0)
  const [reactorScore, setReactorScore] = useState(0)
  const [cards] = useState(() => shuffleCards())
  const [flipped, setFlipped] = useState<number[]>([])
  const [matched, setMatched] = useState<number[]>([])
  const [mismatch, setMismatch] = useState(false)
  const [pulseScore, setPulseScore] = useState(0)
  const [pulsePhase, setPulsePhase] = useState<'wait' | 'go'>('wait')
  const [pulseRound, setPulseRound] = useState(0)
  const [pulseStatus, setPulseStatus] = useState<'waiting' | 'ready' | 'early' | 'hit'>('waiting')
  const [mathScore, setMathScore] = useState(0)
  const [mathQuestion, setMathQuestion] = useState<MathQuestion>(() => createMathQuestion())
  const [mathFeedback, setMathFeedback] = useState<'correct' | 'wrong' | ''>('')
  const [claiming, setClaiming] = useState(false)
  const mismatchTimer = useRef<number | null>(null)
  const duration = gameId === 'orbit' ? 20 : gameId === 'reactor' ? 15 : gameId === 'pulse' ? 30 : gameId === 'math' ? 60 : 90
  const score = gameId === 'orbit' ? orbitScore : gameId === 'reactor' ? reactorScore : gameId === 'pulse' ? pulseScore : gameId === 'math' ? mathScore : matched.length / 2
  const gameWon = gameId === 'memory' ? matched.length === cards.length : gameId === 'orbit' ? elapsed >= duration && orbitScore >= 8 : gameId === 'reactor' ? elapsed >= duration && reactorScore >= 18 : gameId === 'pulse' ? pulseScore >= 5 : mathScore >= 6
  const gameOver = gameId === 'memory' ? gameWon || elapsed >= duration : gameId === 'pulse' ? pulseScore >= 5 || elapsed >= duration : gameId === 'math' ? mathScore >= 6 || elapsed >= duration : elapsed >= duration
  const minTimePassed = elapsed >= minDuration
  const timeLeft = Math.max(0, duration - elapsed)

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startAt.current) / 1000)), 250)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (gameId !== 'orbit' || gameOver) return
    const timer = window.setInterval(() => setTarget(Math.floor(Math.random() * 9)), 680)
    return () => window.clearInterval(timer)
  }, [gameId, gameOver])

  useEffect(() => {
    if (gameId !== 'pulse' || pulsePhase !== 'wait' || gameOver) return
    const timer = window.setTimeout(() => {
      setPulsePhase('go')
      setPulseStatus('ready')
    }, 800 + Math.random() * 1500)
    return () => window.clearTimeout(timer)
  }, [gameId, pulsePhase, pulseRound, gameOver])

  useEffect(() => () => {
    if (mismatchTimer.current !== null) window.clearTimeout(mismatchTimer.current)
  }, [])

  const flipCard = (index: number) => {
    if (gameId !== 'memory' || gameOver || mismatch || flipped.includes(index) || matched.includes(index)) return
    const next = [...flipped, index]
    setFlipped(next)
    if (next.length === 2) {
      const first = cards[next[0]]
      const second = cards[next[1]]
      if (first.symbol === second.symbol) {
        setMatched((current) => [...current, next[0], next[1]])
        setFlipped([])
      } else {
        setMismatch(true)
        mismatchTimer.current = window.setTimeout(() => {
          setFlipped([])
          setMismatch(false)
        }, 680)
      }
    }
  }

  const tapPulse = () => {
    if (gameId !== 'pulse' || gameOver || claiming) return
    if (pulsePhase === 'go') {
      setPulseScore((value) => value + 1)
      setPulsePhase('wait')
      setPulseStatus('hit')
      setPulseRound((value) => value + 1)
    } else {
      setPulseStatus('early')
    }
  }

  const answerMath = (answer: number) => {
    if (gameId !== 'math' || gameOver || claiming) return
    if (answer === mathQuestion.answer) {
      setMathScore((value) => value + 1)
      setMathFeedback('correct')
    } else {
      setMathFeedback('wrong')
    }
    setMathQuestion(createMathQuestion())
  }

  const canClaim = gameWon && minTimePassed && !claiming
  const handleClaim = () => {
    if (!canClaim) return
    setClaiming(true)
    onClaim(score)
  }

  return <section className={`active-mini-game ${gameId}`}>
    <div className="active-game-header"><div><span className="game-live-dot" />{t.playing}</div><button type="button" onClick={onExit} disabled={busy}><ArrowRight size={15} />{t.exit}</button></div>
    <div className="active-game-top"><div><small>{t.eyebrow}</small><h2>{t[gameId]}</h2></div><div className="game-timer"><Clock3 size={15} /><b>{`${timeLeft}s`}</b></div></div>

    {gameId === 'orbit' && <>
      <div className="game-score-strip"><span>{t.hits}</span><strong>{orbitScore} <small>/ 8</small></strong><span>{t.targetTip}</span></div>
      <div className="orbit-game-grid">{Array.from({ length: 9 }, (_, index) => <button type="button" key={index} className={target === index ? 'signal' : ''} disabled={gameOver || claiming} onClick={() => { if (target === index) { setOrbitScore((value) => value + 1); setTarget(Math.floor(Math.random() * 9)) } }} aria-label="Signal tile">{target === index ? <Target size={21} /> : null}</button>)}</div>
      {gameOver && <p className={`game-over-note ${orbitScore >= 8 ? 'won' : 'lost'}`}>{orbitScore >= 8 ? t.gameWon : t.needMore}</p>}
    </>}

    {gameId === 'memory' && <>
      <div className="game-score-strip"><span>{t.pairs}</span><strong>{matched.length / 2} <small>/ 4</small></strong><span>{t.solveTip}</span></div>
      <div className="memory-game-grid">{cards.map((card, index) => {
        const isOpen = flipped.includes(index) || matched.includes(index)
        return <button type="button" key={card.id} className={isOpen ? 'open' : ''} onClick={() => flipCard(index)} disabled={isOpen || gameOver || claiming} aria-label={isOpen ? card.symbol : 'Hidden card'}>{isOpen ? card.symbol : '?'}</button>
      })}</div>
      {gameOver && <p className={`game-over-note ${gameWon ? 'won' : 'lost'}`}>{gameWon ? t.gameWon : t.gameFailed}</p>}
    </>}

    {gameId === 'reactor' && <>
      <div className="game-score-strip"><span>{t.taps}</span><strong>{reactorScore} <small>/ 18</small></strong><span>{t.reactorTip}</span></div>
      <button type="button" className="reactor-core" disabled={gameOver || claiming} onClick={() => setReactorScore((value) => Math.min(100, value + 1))}><span className="reactor-core-ring"><Zap size={29} /></span><b>{t.tapFast}</b><small>{reactorScore} / 18</small></button>
      {gameOver && <p className={`game-over-note ${reactorScore >= 18 ? 'won' : 'lost'}`}>{reactorScore >= 18 ? t.gameWon : t.needMore}</p>}
    </>}

    {gameId === 'pulse' && <>
      <div className="game-score-strip"><span>{t.reactionProgress}</span><strong>{pulseScore} <small>/ 5</small></strong><span>{pulseStatus === 'early' ? t.tooSoon : pulsePhase === 'go' ? t.tapNow : t.waitForGreen}</span></div>
      <button type="button" className={`pulse-target ${pulsePhase === 'go' ? 'ready' : ''}`} disabled={gameOver || claiming} onClick={tapPulse}>
        <span className="pulse-target-ring"><MousePointer2 size={30} /></span>
        <b>{pulsePhase === 'go' ? t.tapNow : t.waitForGreen}</b>
      </button>
      {gameOver && <p className={`game-over-note ${pulseScore >= 5 ? 'won' : 'lost'}`}>{pulseScore >= 5 ? t.gameWon : t.gameFailed}</p>}
    </>}

    {gameId === 'math' && <>
      <div className="game-score-strip"><span>{t.mathProgress}</span><strong>{mathScore} <small>/ 6</small></strong><span>{t.chooseAnswer}</span></div>
      <div className="math-question-card"><span>{t.chooseAnswer}</span><strong>{mathQuestion.label}</strong></div>
      <div className="math-answer-grid">{mathQuestion.options.map((option) => <button type="button" key={option} onClick={() => answerMath(option)} disabled={gameOver || claiming}>{option}</button>)}</div>
      {mathFeedback && <p className={`math-feedback ${mathFeedback}`}>{mathFeedback === 'correct' ? t.correct : t.notQuite}</p>}
      {gameOver && <p className={`game-over-note ${mathScore >= 6 ? 'won' : 'lost'}`}>{mathScore >= 6 ? t.gameWon : t.gameFailed}</p>}
    </>}

    <div className="active-game-footer">
      <span>{!gameOver && gameId !== 'memory' ? `${t.timeLeft}: ${timeLeft}s` : gameWon && !minTimePassed ? t.minTime : gameOver && !gameWon ? t.gameFailed : ''}</span>
      {gameWon && <button type="button" className="arcade-play-btn" disabled={!canClaim || busy} onClick={handleClaim}>{busy || claiming ? <span className="spinner light" /> : <CheckCircle2 size={16} />}{t.claimReward}</button>}
      {gameOver && !gameWon && <button type="button" className="arcade-play-btn secondary" disabled={busy} onClick={onExit}>{t.exit}</button>}
    </div>
  </section>
}

function createMathQuestion(): MathQuestion {
  const mode = Math.floor(Math.random() * 3)
  const a = Math.floor(Math.random() * 9) + 4
  const b = Math.floor(Math.random() * 8) + 2
  const label = mode === 0 ? `${a} + ${b}` : mode === 1 ? `${Math.max(a, b)} − ${Math.min(a, b)}` : `${a} × ${Math.max(2, Math.min(5, b % 6))}`
  const answer = mode === 0 ? a + b : mode === 1 ? Math.abs(a - b) : a * Math.max(2, Math.min(5, b % 6))
  const options = new Set<number>([answer])
  while (options.size < 4) options.add(Math.max(0, answer + Math.floor(Math.random() * 11) - 5))
  return { label, answer, options: [...options].sort(() => Math.random() - 0.5) }
}

function shuffleCards() {
  const symbols = ['◆', '●', '▲', '✦']
  return [...symbols, ...symbols]
    .map((symbol, index) => ({ id: `${symbol}-${index}`, symbol, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ id, symbol }) => ({ id, symbol }))
}

