import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowDownToLine, ArrowRight, ArrowUpRight, BadgeCheck, Bell, Check, CheckCircle2,
  CircleHelp, Clipboard, Coins, Copy, Gift, Globe2, House, ListChecks, LockKeyhole,
  LogOut, Menu, ShieldCheck, UserRound, Users, Wallet, X, Clock3, Timer, Sparkles, RefreshCw, Gamepad2,
} from 'lucide-react'
import { canShowAutomaticAd, prepareEasyGramAd, showEasyGramAd, showRewardAdWithPulse } from './lib/ads'
import LoadingScreen from './components/LoadingScreen'
import NativeTaskPopup from './components/NativeTaskPopup'
import EarnHub, { HomeRewardsPreview } from './components/EarnHub'
import './loading.css'

type Lang = 'ar' | 'en'
type Page = 'home' | 'tasks' | 'play' | 'withdraw' | 'profile'
type User = {
  telegramId: string
  username: string | null
  firstName: string
  photoUrl?: string | null
  coinBalance: number
  usdtBalance: number
  legacyGramBalance?: number
  withdrawalAdsWatched: number
  withdrawalAdsRequired: number
  withdrawalsToday: number
  referralsCount: number
  qualifiedReferralsCount?: number
  pendingReferralsCount?: number
  completedTasks: number
  language: Lang
  createdAt?: string
}
type Settings = {
  app_name: string
  welcome_text: string
  min_withdrawal: number
  withdrawal_ads_required: number
  referral_reward: number
  referral_reward_coins: number
  mining_rate_per_hour_coins: number
  adsgram_native_task_reward_coins: number
  min_exchange_coins: number
  coin_exchange_rate: number
  min_withdrawal_usdt: number
  max_withdrawal_usdt: number
  referral_tasks_required: number
  support_username: string
  terms_url: string
  gram_network_label: string
  gram_withdrawals_enabled: boolean
  gram_payment_note: string
  mining_rate_per_hour: number
  mining_duration_hours: number
  auto_ads_enabled: boolean
  auto_ads_interval_seconds: number
  maintenance_mode: boolean
  adsgram_auto_block: string
  adsgram_reward_block: string
  adsgram_native_task_block: string
  adsgram_native_task_reward_gram: number
}
type Task = {
  id: number
  title: string
  description: string
  reward_coins: number
  kind: 'ad' | 'link' | 'channel' | 'bot'
  url: string | null
  max_completions: number
  cooldown_hours: number
  completed: number
  cycle_completed?: number
  remaining: number | null
  next_available_at?: string | null
}
type RequiredChannel = { id: number; title: string; joinUrl: string; isMember: boolean; checkError?: string | null }
type MiningSession = { id: string; started_at: string; ends_at: string; rate_per_hour: number; duration_hours: number }
type Withdrawal = {
  id: string
  amount_usdt: number
  method: 'binance' | 'gram' | 'bnb'
  target: string
  status: 'pending' | 'completed' | 'rejected'
  created_at: string
}

const translations: Record<Lang, Record<string, string>> = {
  en: {
    home: 'Home', tasks: 'Tasks', play: 'Arcade', withdraw: 'Withdraw', profile: 'Profile', admin: 'Admin',
    hello: 'Hello', welcome: 'Your simple way to earn Coins.', available: 'Coin balance',
    gram: 'GRAM', startTasks: 'Start earning', recent: 'Your activity', completedTasks: 'Tasks completed',
    referrals: 'Invited friends', qualifiedReferrals: 'Rewarded', pendingReferrals: 'Pending reward', quickActions: 'Quick access', earnTitle: 'Earn more Coins', earnDesc: 'Complete a task and add Coins to your balance.',
    openTasks: 'Explore tasks', invite: 'Invite friends', inviteDesc: 'Share your link and receive a referral reward.',
    referralEligibility: 'Your friend needs to complete {count} different tasks before the referral reward is credited.',
    copyLink: 'Copy invite link', copied: 'Copied', shareLink: 'Share invite', referralLinkLabel: 'Your personal invite link', referralUnavailable: 'Invite link is being prepared. Refresh in a moment.', taskTitle: 'Available tasks', taskSubtitle: 'Complete tasks to earn Coins.',
    reward: 'Reward', completed: 'Completed', remaining: 'left', unlimited: 'Repeatable', watchAd: 'Watch ad', openTask: 'Open task', verify: 'Verify task', verifying: 'Checking…',
    noTasks: 'No tasks available right now.', taskDone: 'Task completed successfully!',
    withdrawTitle: 'USDT withdrawal', withdrawSubtitle: 'Exchange Coins into USDT, then request a payout.',
    walletAddress: 'Withdrawal destination', amount: 'Amount (USDT)', submit: 'Request withdrawal',
    withdrawalProgress: 'Withdrawal ads', adsToUnlock: 'ads needed before each withdrawal',
    watchWithdrawalAd: 'Watch withdrawal ad', minWithdrawal: 'Withdrawal range',
    history: 'Withdrawal history', noHistory: 'No withdrawal requests yet.', pending: 'Pending', paid: 'Paid', rejected: 'Rejected',
    profileTitle: 'Your profile', account: 'Account information', telegramId: 'Telegram ID', joined: 'Joined', language: 'Language',
    support: 'Support', terms: 'Terms', adminPanel: 'Open admin panel',
    loading: 'Loading Easy Gram…', openTelegram: 'Open Easy Gram from Telegram', openTelegramDesc: 'This Mini App needs to be opened from the Easy Gram Telegram bot so your account can be verified.',
    refresh: 'Refresh', cancel: 'Cancel', confirm: 'Confirm', error: 'Something went wrong.',
    adNeed: 'Watch the ad to continue.', balanceTooLow: 'Your balance is not enough.',
    invalidWallet: 'Please enter a valid withdrawal destination.', amountHint: 'Available',
    exchangeTitle: 'Convert Coins to USDT', exchangeHint: 'Watch one verified ad to exchange Coins.', exchangeAmount: 'Coins to exchange', exchangeButton: 'Watch ad & exchange', exchangeRate: '2,000 Coins = 0.005 USDT', usdtBalance: 'USDT balance', coinBalance: 'Coin balance', method: 'Withdrawal method', binance: 'Binance ID', gramAddress: 'GRAM wallet address',
    withdrawalSent: 'Your withdrawal request has been sent.',
    maintenance: 'Easy Gram is under maintenance. Please check back soon.',
    welcomeNew: 'Welcome to Easy Gram', footer: 'Simple tasks. Clear rewards.',
    kind_ad: 'Ad task', kind_link: 'Visit link', kind_channel: 'Join channel', kind_bot: 'Open bot', adAvailableIn: 'Available in',
    copy: 'Copy', copiedLink: 'Invite link copied to clipboard.', inviteFriends: 'Invite friends',
    mining: 'Hourly mining', miningDesc: 'Earn Coins every hour. Your full session reward is added when you claim.', miningTotalReward: 'Session reward', miningStart: 'Start mining', miningActive: 'Mining in progress', miningReady: 'Your mining reward is ready', miningClaim: 'Claim reward', miningRate: 'Earn per hour', miningTimeLeft: 'Time remaining', miningDuration: 'Session length', miningClaimed: 'Mining reward added to your balance.', miningStarted: 'Mining session started.', miningWait: 'Please wait until the clock completes.',
    joinRequired: 'Join our channels to continue', joinRequiredDesc: 'You need to join every channel below before you can earn or withdraw.', checkMembership: 'Check membership', membershipChecking: 'Checking membership…', membershipDone: 'Subscription verified. Welcome!', membershipError: 'Please join all required channels first.', botCheckHint: 'If you have joined but verification fails, the bot may need administrator access in the channel.',
  },
  ar: {
    home: 'الرئيسية', tasks: 'المهام', play: 'الألعاب والمكافآت', withdraw: 'السحب', profile: 'الملف الشخصي', admin: 'الإدارة',
    hello: 'مرحباً', welcome: 'طريقتك البسيطة لجمع Coins.', available: 'رصيد الكوينز',
    gram: 'GRAM', startTasks: 'ابدأ الربح', recent: 'نشاطك', completedTasks: 'المهام المكتملة',
    referrals: 'الأصدقاء المدعوون', qualifiedReferrals: 'تمت مكافأتهم', pendingReferrals: 'بانتظار إكمال المهام', quickActions: 'الوصول السريع', earnTitle: 'اجمع المزيد من Coins', earnDesc: 'أكمل المهام وأضف Coins إلى رصيدك.',
    openTasks: 'استعرض المهام', invite: 'ادعُ أصدقاءك', inviteDesc: 'شارك رابطك واحصل على مكافأة الإحالة.',
    copyLink: 'نسخ رابط الدعوة', copied: 'تم النسخ', taskTitle: 'المهام المتاحة', taskSubtitle: 'أكمل المهام لتحصل على Coins.',
    reward: 'المكافأة', completed: 'مكتملة', remaining: 'متبقية', unlimited: 'متكررة', watchAd: 'مشاهدة إعلان', openTask: 'فتح المهمة', verify: 'تحقق من المهمة', verifying: 'جارٍ التحقق…',
    noTasks: 'لا توجد مهام متاحة حالياً.', taskDone: 'تم إكمال المهمة بنجاح!',
    withdrawTitle: 'سحب USDT', withdrawSubtitle: 'حوّل Coins إلى USDT ثم أرسل طلب السحب.',
    walletAddress: 'وجهة السحب', amount: 'المبلغ (USDT)', submit: 'إرسال طلب السحب',
    withdrawalProgress: 'إعلانات السحب', adsToUnlock: 'إعلانات مطلوبة قبل كل عملية سحب',
    watchWithdrawalAd: 'مشاهدة إعلان السحب', minWithdrawal: 'الحد الأدنى للسحب',
    history: 'سجل السحوبات', noHistory: 'لا توجد طلبات سحب حتى الآن.', pending: 'قيد المراجعة', paid: 'تم الدفع', rejected: 'مرفوض',
    profileTitle: 'ملفك الشخصي', account: 'معلومات الحساب', telegramId: 'معرّف تيليجرام', joined: 'تاريخ الانضمام', language: 'اللغة',
    support: 'الدعم', terms: 'الشروط', adminPanel: 'فتح لوحة الإدارة',
    loading: 'جارٍ تحميل Easy Gram…', openTelegram: 'افتح Easy Gram من تيليجرام', openTelegramDesc: 'يجب فتح التطبيق المصغر من بوت Easy Gram حتى نتمكن من التحقق من حسابك.',
    refresh: 'تحديث', cancel: 'إلغاء', confirm: 'تأكيد', error: 'حدث خطأ، حاول مرة أخرى.',
    adNeed: 'شاهد الإعلان للمتابعة.', balanceTooLow: 'رصيدك غير كافٍ.',
    invalidWallet: 'يرجى إدخال وجهة سحب صحيحة.', amountHint: 'المتاح',
    exchangeTitle: 'تحويل Coins إلى USDT', exchangeHint: 'شاهد إعلاناً موثّقاً واحداً لإتمام التحويل.', exchangeAmount: 'عدد الكوينز للتحويل', exchangeButton: 'شاهد الإعلان وحوّل', exchangeRate: '2,000 Coin = 0.005 USDT', usdtBalance: 'رصيد USDT', coinBalance: 'رصيد Coins', method: 'طريقة السحب', binance: 'معرّف Binance', gramAddress: 'عنوان محفظة GRAM',
    withdrawalSent: 'تم إرسال طلب السحب بنجاح.',
    maintenance: 'Easy Gram تحت الصيانة حالياً. حاول مرة أخرى لاحقاً.',
    welcomeNew: 'أهلاً بك في Easy Gram', footer: 'مهام بسيطة. مكافآت واضحة.',
    kind_ad: 'مهمة إعلان', kind_link: 'زيارة رابط', kind_channel: 'الانضمام إلى قناة', kind_bot: 'فتح بوت', adAvailableIn: 'متاحة بعد',
    referralEligibility: 'تُضاف مكافأة الإحالة بعد أن يُكمل صديقك {count} مهام مختلفة.',
    copy: 'نسخ', copiedLink: 'تم نسخ رابط الدعوة.', inviteFriends: 'ادعُ أصدقاءك', shareLink: 'مشاركة الرابط', referralLinkLabel: 'رابط الدعوة الخاص بك', referralUnavailable: 'جارٍ تجهيز رابط الدعوة. حدّث الصفحة بعد لحظة.',
    mining: 'التعدين بالساعة', miningDesc: 'اكسب Coins مقابل كل ساعة تعدين، واستلم مكافأة الجلسة بعد انتهائها.', miningTotalReward: 'مكافأة الجلسة', miningStart: 'ابدأ التعدين', miningActive: 'التعدين جارٍ الآن', miningReady: 'مكافأة التعدين جاهزة', miningClaim: 'استلام المكافأة', miningRate: 'المكسب لكل ساعة', miningTimeLeft: 'الوقت المتبقي', miningDuration: 'مدة الجلسة', miningClaimed: 'تمت إضافة مكافأة التعدين إلى رصيدك.', miningStarted: 'بدأت جلسة التعدين.', miningWait: 'انتظر حتى تكتمل الساعة.',
    joinRequired: 'اشترك في قنواتنا للمتابعة', joinRequiredDesc: 'يجب الانضمام إلى جميع القنوات أدناه قبل الربح أو السحب.', checkMembership: 'تحقق من الاشتراك', membershipChecking: 'جارٍ التحقق من الاشتراك…', membershipDone: 'تم تأكيد الاشتراك. أهلاً بك!', membershipError: 'يرجى الانضمام إلى جميع القنوات أولاً.', botCheckHint: 'إذا انضممت ولم ينجح التحقق، فقد يحتاج البوت إلى صلاحية مشرف في القناة.',
  },
}

const defaultSettings: Settings = {
  app_name: 'Easy Gram', welcome_text: 'Complete simple tasks and collect Gram rewards.',
  min_withdrawal: 1, withdrawal_ads_required: 5, referral_reward: 0.05, referral_tasks_required: 3,
  referral_reward_coins: 50000, mining_rate_per_hour_coins: 20000, adsgram_native_task_reward_coins: 10000,
  min_exchange_coins: 1000, coin_exchange_rate: 0.0000025, min_withdrawal_usdt: 0.1, max_withdrawal_usdt: 0.2,
  support_username: '', terms_url: '', gram_network_label: 'Gram wallet',
  gram_withdrawals_enabled: true, gram_payment_note: '', mining_rate_per_hour: 0.02, mining_duration_hours: 6, maintenance_mode: false,
  adsgram_auto_block: 'int-58010', adsgram_reward_block: 'int-58009',
  adsgram_native_task_block: '', adsgram_native_task_reward_gram: 0.01,
  auto_ads_enabled: true, auto_ads_interval_seconds: 30,
}

function telegramInitData() {
  return (window as any).Telegram?.WebApp?.initData || ''
}

async function api<T = any>(url: string, body?: Record<string, unknown>, method = body ? 'POST' : 'GET'): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const initData = telegramInitData()
  if (initData) { headers.Authorization = `tga ${initData}`; headers['X-Telegram-Init-Data'] = initData }
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (data.code === 'SUBSCRIPTION_REQUIRED' && data.subscription) {
      window.dispatchEvent(new CustomEvent('easygram:subscription-required', { detail: data.subscription }))
    }
    throw new Error(data.error || `Request failed (${response.status})`)
  }
  return data as T
}

function formatGram(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(Number(value || 0))
}

function formatCoins(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.trunc(Number(value || 0)))
}

function formatUsdt(value: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(Number(value || 0))
}

function dateLabel(value: string) {
  try { return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) } catch { return value }
}

function TaskIcon({ kind }: { kind: Task['kind'] }) {
  if (kind === 'ad') return <Bell size={20} />
  if (kind === 'channel') return <Users size={20} />
  if (kind === 'bot') return <Globe2 size={20} />
  return <ArrowUpRight size={20} />
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    let saved = ''
    try { saved = localStorage.getItem('easygram.lang') || '' } catch { /* storage may be disabled in private WebViews */ }
    if (saved === 'ar' || saved === 'en') return saved
    const tgLang = String((window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code || navigator.language || '')
    return tgLang.toLowerCase().startsWith('ar') ? 'ar' : 'en'
  })
  const t = useCallback((key: string) => translations[lang][key] || key, [lang])
  const [page, setPage] = useState<Page>(() => {
    let saved = ''
    try { saved = sessionStorage.getItem('easygram.page') || '' } catch { /* session storage may be disabled */ }
    return saved === 'home' || saved === 'tasks' || saved === 'play' || saved === 'withdraw' || saved === 'profile' ? saved : 'home'
  })
  const [hubInitialTab, setHubInitialTab] = useState<'games' | 'daily' | 'codes' | 'leaderboard'>('games')
  const [user, setUser] = useState<User | null>(null)
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [tasks, setTasks] = useState<Task[]>([])
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])
  const [taskSessions, setTaskSessions] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [splashVisible, setSplashVisible] = useState(true)
  const [splashFading, setSplashFading] = useState(false)
  const [splashProgress, setSplashProgress] = useState(5)
  const [preloadRevision, setPreloadRevision] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [amount, setAmount] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [exchangeAmount, setExchangeAmount] = useState('')
  const [withdrawalMethod, setWithdrawalMethod] = useState<'binance' | 'gram'>('binance')
  const [referralLink, setReferralLink] = useState('')
  const [requiredChannels, setRequiredChannels] = useState<RequiredChannel[]>([])
  const [checkingMembership, setCheckingMembership] = useState(false)
  const [miningSession, setMiningSession] = useState<MiningSession | null>(null)
  const [clockNow, setClockNow] = useState(Date.now())
  const tasksLoadedRef = useRef(false)
  const withdrawalsLoadedRef = useRef(false)
  const miningLoadedRef = useRef(false)
  const isPreloadingRef = useRef(false)

  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const membershipComplete = requiredChannels.every((channel) => channel.isMember)
  const changeLanguage = (next: Lang) => {
    try { localStorage.setItem('easygram.lang', next) } catch { /* storage may be blocked */ }
    setLang(next)
  }
  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }, [])

  const updateCoinBalance = useCallback((balance: number) => {
    setUser((current) => current ? { ...current, coinBalance: Math.max(0, Math.trunc(Number(balance) || 0)) } : current)
  }, [])

  const loadAccount = useCallback(async (preload = false) => {
    if (!telegramInitData()) {
      setLoading(false)
      return
    }
    try {
      const data = await api<any>('/api/auth/me', { language: lang })
      const channels: RequiredChannel[] = Array.isArray(data.subscription?.channels) ? data.subscription.channels : []
      setUser(data.user)
      ;(window as any).__easyGramIsAdmin = Boolean(data.isAdmin)
      setSettings({ ...defaultSettings, ...data.settings })
      setReferralLink(data.referralLink || '')
      setRequiredChannels(channels)

      // Initial boot warms every main tab so navigation does not reveal empty
      // panels or start a second wave of requests after the splash disappears.
      // Keep earning endpoints behind the same channel-membership gate.
      if (preload && data.user && channels.every((channel) => channel.isMember)) {
        isPreloadingRef.current = true
        const warmups: Promise<unknown>[] = []
        if (!tasksLoadedRef.current) {
          warmups.push(api<{ tasks: Task[] }>('/api/tasks').then((result) => {
            setTasks(Array.isArray(result.tasks) ? result.tasks : [])
            tasksLoadedRef.current = true
          }))
        }
        if (!withdrawalsLoadedRef.current) {
          warmups.push(api<{ withdrawals: Withdrawal[] }>('/api/withdraw').then((result) => {
            setWithdrawals(Array.isArray(result.withdrawals) ? result.withdrawals : [])
            withdrawalsLoadedRef.current = true
          }))
        }
        if (!miningLoadedRef.current) {
          warmups.push(api<{ session: MiningSession | null }>('/api/mining').then((result) => {
            setMiningSession(result.session || null)
            miningLoadedRef.current = true
          }))
        }
        try { await Promise.allSettled(warmups) } finally {
          isPreloadingRef.current = false
          setPreloadRevision((revision) => revision + 1)
        }
      }

      // The user's explicit local language choice is authoritative. Never let a
      // delayed account response silently switch the interface language.
      setError('')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('error')
      setError(message.includes('Telegram signature verification failed')
        ? (lang === 'ar'
          ? 'فشل التحقق من هوية تيليجرام. تأكد أن TELEGRAM_BOT_TOKEN هو توكن بوت Easy Gram نفسه، وليس توكن SLY، ثم أغلق التطبيق وافتحه من زر البوت.'
          : 'Telegram signature verification failed. Make sure TELEGRAM_BOT_TOKEN belongs to this Easy Gram bot (not SLY), then close and reopen the Mini App from the bot button.')
        : message)
    } finally {
      setLoading(false)
    }
  }, [t, lang])

  const loadTasks = useCallback(async () => {
    try {
      const data = await api<{ tasks: Task[] }>('/api/tasks')
      setTasks(data.tasks || [])
      tasksLoadedRef.current = true
    } catch (err) {
      notify(err instanceof Error ? err.message : t('error'))
    }
  }, [t])

  const loadWithdrawals = useCallback(async () => {
    try {
      const data = await api<{ withdrawals: Withdrawal[] }>('/api/withdraw')
      setWithdrawals(data.withdrawals || [])
      withdrawalsLoadedRef.current = true
    } catch (err) {
      notify(err instanceof Error ? err.message : t('error'))
    }
  }, [t])

  const loadMining = useCallback(async () => {
    try {
      const data = await api<{ session: MiningSession | null }>('/api/mining')
      setMiningSession(data.session || null)
      miningLoadedRef.current = true
    } catch (err) {
      if (err instanceof Error && !err.message.includes('SUBSCRIPTION_REQUIRED')) notify(err.message)
    }
  }, [])

  const checkMembership = async () => {
    setCheckingMembership(true)
    try {
      const data = await api<any>('/api/subscribe', { action: 'check' })
      const channels = Array.isArray(data.subscription?.channels) ? data.subscription.channels : []
      if (data.subscription?.isComplete) {
        notify(t('membershipDone'))
        await loadAccount(true)
      } else {
        setRequiredChannels(channels)
        notify(t('membershipError'))
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : t('error'))
    } finally {
      setCheckingMembership(false)
    }
  }

  const startMining = async () => {
    setBusy('mining')
    try {
      const adSessionId = await runVerifiedAd('mining_start')
      const data = await api<any>('/api/mining', { action: 'start', adSessionId })
      setMiningSession(data.session || null)
      notify(t('miningStarted'))
    } catch (err) {
      notify(adErrorText(err))
    } finally { setBusy(null) }
  }

  const claimMining = async () => {
    setBusy('mining')
    try {
      const adSessionId = await runVerifiedAd('mining_claim')
      const data = await api<any>('/api/mining', { action: 'claim', adSessionId })
      setMiningSession(null)
      await loadAccount()
      notify(`${t('miningClaimed')} +${formatCoins(data.rewardCoins)} COINS`)
    } catch (err) {
      notify(adErrorText(err))
    } finally { setBusy(null) }
  }

  useEffect(() => {
    try { localStorage.setItem('easygram.lang', lang) } catch { /* storage may be disabled */ }
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])
  useEffect(() => { void loadAccount(true) }, [loadAccount])
  // Preload both AdsGram controllers while the app is idle. Rewarded ads can
  // then call show() synchronously from the actual Telegram tap (SLY behavior).
  useEffect(() => {
    const blockIds = [...new Set([
      String(settings.adsgram_reward_block || '').trim(),
      String(settings.adsgram_auto_block || '').trim(),
    ])].filter((id) => /^int-\d+$/.test(id))
    for (const blockId of blockIds) {
      void prepareEasyGramAd(blockId).catch((error) => {
        console.warn(`[Easy Gram] AdsGram preload ${blockId}:`, error instanceof Error ? error.message : error)
      })
    }
  }, [settings.adsgram_reward_block, settings.adsgram_auto_block])
  useEffect(() => {
    if (!splashVisible || !loading) return
    const timer = window.setInterval(() => {
      setSplashProgress((current) => current >= 92 ? current : current + (92 - current) * 0.075 + 0.35)
    }, 120)
    return () => window.clearInterval(timer)
  }, [splashVisible, loading])
  useEffect(() => {
    if (loading || !splashVisible) return
    setSplashProgress(100)
    const fadeTimer = window.setTimeout(() => setSplashFading(true), 260)
    const hideTimer = window.setTimeout(() => setSplashVisible(false), 820)
    return () => { window.clearTimeout(fadeTimer); window.clearTimeout(hideTimer) }
  }, [loading, splashVisible])
  useEffect(() => {
    if (!user?.telegramId) return
    const initData = telegramInitData()
    if (!initData) return
    let stopped = false
    const ping = async () => {
      if (stopped || document.visibilityState !== 'visible') return
      try {
        await fetch('/api/presence', {
          method: 'POST',
          headers: { Authorization: `tga ${initData}`, 'X-Telegram-Init-Data': initData },
        })
      } catch { /* Presence is best-effort and must not interrupt earning. */ }
    }
    void ping()
    const timer = window.setInterval(() => { void ping() }, 120000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [user?.telegramId])
  useEffect(() => {
    if (!loading && !isPreloadingRef.current && user?.telegramId && membershipComplete && page === 'tasks' && !tasksLoadedRef.current) void loadTasks()
  }, [loading, user?.telegramId, membershipComplete, page, preloadRevision, loadTasks])
  useEffect(() => {
    if (!loading && !isPreloadingRef.current && user?.telegramId && membershipComplete && page === 'withdraw' && !withdrawalsLoadedRef.current) void loadWithdrawals()
  }, [loading, user?.telegramId, membershipComplete, page, preloadRevision, loadWithdrawals])
  useEffect(() => {
    if (!loading && !isPreloadingRef.current && user?.telegramId && membershipComplete && !miningLoadedRef.current) void loadMining()
  }, [loading, user?.telegramId, membershipComplete, preloadRevision, loadMining])
  useEffect(() => { const timer = window.setInterval(() => setClockNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [])

  // SLY-style automatic AdsGram interstitials: first ad shortly after the
  // account is ready, then 30 seconds after a successful ad. Failed/no-fill
  // attempts retry after 10 seconds. Manual reward ads restart the cycle.
  useEffect(() => {
    if (loading || !user?.telegramId || !membershipComplete || settings.maintenance_mode || !settings.auto_ads_enabled) return
    let cancelled = false
    let timer: number | undefined
    const clear = () => { if (timer !== undefined) window.clearTimeout(timer) }
    const schedule = (delay: number) => {
      clear()
      timer = window.setTimeout(async () => {
        if (cancelled) return
        if (document.visibilityState !== 'visible') { schedule(10000); return }
        if (!canShowAutomaticAd()) { schedule(5000); return }
        const blockId = String(settings.adsgram_auto_block || '')
        if (!/^int-\d+$/.test(blockId)) { schedule(10000); return }
        try {
          await showEasyGramAd(blockId, true)
          schedule(Math.max(30, Number(settings.auto_ads_interval_seconds) || 30) * 1000)
        } catch (error) {
          console.warn('[Easy Gram] automatic ad skipped:', error instanceof Error ? error.message : error)
          schedule(10000)
        }
      }, delay)
    }
    const onManualAd = () => schedule(10000)
    const onVisible = () => { if (document.visibilityState === 'visible') schedule(1000) }
    window.addEventListener('easygram:manual-ad-finished', onManualAd)
    document.addEventListener('visibilitychange', onVisible)
    schedule(1000)
    return () => {
      cancelled = true
      clear()
      window.removeEventListener('easygram:manual-ad-finished', onManualAd)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loading, user?.telegramId, membershipComplete, settings.maintenance_mode, settings.auto_ads_enabled, settings.auto_ads_interval_seconds, settings.adsgram_auto_block])
  useEffect(() => {
    const onSubscriptionRequired = (event: Event) => {
      const detail = (event as CustomEvent).detail
      if (Array.isArray(detail?.channels)) setRequiredChannels(detail.channels)
    }
    window.addEventListener('easygram:subscription-required', onSubscriptionRequired)
    return () => window.removeEventListener('easygram:subscription-required', onSubscriptionRequired)
  }, [])

  const changePage = (next: Page) => {
    try { sessionStorage.setItem('easygram.page', next) } catch { /* storage may be blocked */ }
    setPage(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const refreshAccount = async () => {
    await loadAccount()
    if (page === 'tasks') await loadTasks()
    if (page === 'withdraw') await loadWithdrawals()
  }

  const adErrorText = (error: unknown) => {
    const message = error instanceof Error ? error.message : ''
    if (lang === 'ar') {
      const messages: Record<string, string> = {
        not_ready: 'إعلان AdsGram لا يزال يجهز. انتظر لحظة ثم حاول مجدداً.',
        busy: 'هناك إعلان آخر يعمل أو يوجد فاصل قصير بين الإعلانات. حاول بعد قليل.',
        no_fill: 'لا يوجد إعلان متاح حالياً. حاول مرة أخرى لاحقاً.',
        too_short: 'شاهد الإعلان لمدة 5 ثوانٍ كاملة على الأقل.',
        timeout: 'انتهت مهلة الإعلان. أغلقه وحاول مرة أخرى.',
      }
      if (messages[message]) return messages[message]
    } else {
      const messages: Record<string, string> = {
        not_ready: 'AdsGram is still loading. Please try again in a moment.',
        busy: 'Another ad is running or the short ad cooldown is active. Try again shortly.',
        no_fill: 'No ad is available right now. Please try again later.',
        too_short: 'Watch the ad for at least 5 full seconds.',
        timeout: 'The ad timed out. Close it and try again.',
      }
      if (messages[message]) return messages[message]
    }
    return message || t('error')
  }

  const runVerifiedAd = async (placement: 'task' | 'withdrawal' | 'mining_start' | 'mining_claim' | 'exchange' | 'game_attempt') => {
    const blockId = String(settings.adsgram_reward_block || '').trim()
    if (!/^int-\d+$/.test(blockId)) {
      throw new Error('إعدادات إعلان المكافآت غير صحيحة. اضبط INT block من لوحة الإدارة.')
    }

    // SLY flow: ask the server to stamp the start immediately, while AdsGram
    // is invoked synchronously from the same user tap. The server records the
    // timestamp before any Supabase write, so database latency cannot shorten
    // the measured ad session.
    const beginPromise = api<any>('/api/ads/pulse', { action: 'begin', placement })
    beginPromise.catch(() => undefined)
    let begin: any = null
    let confirmAttempted = false
    try {
      const result = await showRewardAdWithPulse(blockId, placement)
      begin = await beginPromise
      if (String(begin.blockId || '').trim() !== blockId || !begin.sessionId) {
        throw new Error('تغيّر معرّف إعلان المكافآت. حدّث التطبيق ثم حاول مجدداً.')
      }
      confirmAttempted = true
      await api('/api/ads/pulse', {
        action: 'confirm', placement, sessionId: begin.sessionId,
        pulseAway: result.pulseAway, awayMs: result.awayMs,
      })
      return String(begin.sessionId)
    } catch (error) {
      // Remove an unused begin row after no-fill/skip/short-view. Never cancel
      // after confirm was sent: the server may already have committed it.
      begin = begin || await beginPromise.catch(() => null)
      if (!confirmAttempted && begin?.sessionId) {
        await api('/api/ads/pulse', {
          action: 'cancel', placement, sessionId: begin.sessionId,
        }).catch(() => undefined)
      }
      throw error
    }
  }

  const watchGameBonusAttempt = async () => {
    const adSessionId = await runVerifiedAd('game_attempt')
    const result = await api<any>('/api/gamification', { action: 'bonus_attempt', adSessionId })
    notify(lang === 'ar'
      ? `تمت إضافة محاولة ألعاب جديدة! (${result.bonusAttempts}/${result.bonusLimit})`
      : `One extra game attempt added! (${result.bonusAttempts}/${result.bonusLimit})`)
    return result
  }

  const openHubTab = (tab: 'games' | 'daily' | 'codes' | 'leaderboard') => {
    setHubInitialTab(tab)
    changePage('play')
  }

  const startAd = async (placement: 'task' | 'withdrawal', taskId?: number) => {
    const key = taskId ? `task-${taskId}` : 'withdrawal-ad'
    setBusy(key)
    try {
      const adSessionId = await runVerifiedAd(placement)
      if (placement === 'withdrawal') {
        await loadAccount()
        notify(lang === 'ar' ? 'تم احتساب إعلان السحب.' : 'Withdrawal ad counted.')
      } else if (taskId) {
        const completion = await api<any>('/api/tasks', { action: 'complete', taskId, adSessionId })
        await loadTasks()
        await loadAccount()
        notify(`${t('taskDone')} +${formatCoins(completion.reward)} COINS`)
      }
    } catch (err) {
      notify(adErrorText(err))
    } finally {
      setBusy(null)
    }
  }

  const openTask = async (task: Task) => {
    setBusy(`task-${task.id}`)
    try {
      const data = await api<any>('/api/tasks', { action: 'open', taskId: task.id })
      setTaskSessions((current) => ({ ...current, [task.id]: data.taskSessionId }))
      const tg = (window as any).Telegram?.WebApp
      if (data.url && tg?.openLink) tg.openLink(data.url)
      else if (data.url) window.open(data.url, '_blank', 'noopener,noreferrer')
      notify(lang === 'ar' ? 'افتح الرابط ثم ارجع واضغط تحقق.' : 'Open the link, return here, then verify the task.')
    } catch (err) {
      notify(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusy(null)
    }
  }

  const completeTask = async (task: Task) => {
    const taskSessionId = taskSessions[task.id]
    if (!taskSessionId) return notify(lang === 'ar' ? 'افتح المهمة أولاً.' : 'Open the task first.')
    setBusy(`task-${task.id}`)
    try {
      const data = await api<any>('/api/tasks', { action: 'complete', taskId: task.id, taskSessionId })
      setTaskSessions((current) => { const next = { ...current }; delete next[task.id]; return next })
      await loadTasks()
      await loadAccount()
      notify(`${t('taskDone')} +${formatCoins(data.reward)} COINS`)
    } catch (err) {
      notify(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusy(null)
    }
  }

  const exchangeCoins = async () => {
    const parsedCoins = Number(exchangeAmount)
    if (!Number.isSafeInteger(parsedCoins) || parsedCoins < Number(settings.min_exchange_coins || 1000)) {
      return notify(lang === 'ar' ? `الحد الأدنى للتحويل ${formatCoins(settings.min_exchange_coins || 1000)} Coin.` : `Minimum exchange is ${formatCoins(settings.min_exchange_coins || 1000)} Coins.`)
    }
    if (parsedCoins > Number(user?.coinBalance || 0)) return notify(t('balanceTooLow'))
    setBusy('exchange')
    try {
      const adSessionId = await runVerifiedAd('exchange')
      const data = await api<any>('/api/exchange', { amountCoins: parsedCoins, adSessionId })
      setExchangeAmount('')
      await loadAccount()
      notify(lang === 'ar'
        ? `تم تحويل ${formatCoins(parsedCoins)} Coin إلى ${formatUsdt(data.usdtGained)} USDT.`
        : `Converted ${formatCoins(parsedCoins)} Coins into ${formatUsdt(data.usdtGained)} USDT.`)
    } catch (err) {
      notify(adErrorText(err))
    } finally {
      setBusy(null)
    }
  }

  const submitWithdrawal = async (event: FormEvent) => {
    event.preventDefault()
    const parsedAmount = Number(amount)
    if (!Number.isFinite(parsedAmount) || parsedAmount < Number(settings.min_withdrawal_usdt) || parsedAmount > Number(settings.max_withdrawal_usdt)) {
      return notify(lang === 'ar' ? 'المبلغ يجب أن يكون بين 0.1 و0.2 USDT.' : 'Amount must be between 0.1 and 0.2 USDT.')
    }
    if (walletAddress.trim().length < 6) return notify(t('invalidWallet'))
    setBusy('submit-withdrawal')
    try {
      await api('/api/withdraw', { amount: parsedAmount, method: withdrawalMethod, target: walletAddress.trim() })
      setAmount('')
      setWalletAddress('')
      await loadAccount()
      await loadWithdrawals()
      notify(t('withdrawalSent'))
    } catch (err) {
      notify(err instanceof Error ? err.message : t('error'))
    } finally {
      setBusy(null)
    }
  }

  const copyReferral = async () => {
    if (!referralLink) return notify(lang === 'ar' ? 'رابط الدعوة غير مضبوط. تواصل مع الإدارة.' : 'Invite link is not configured. Contact support.')
    try {
      await navigator.clipboard.writeText(referralLink)
      notify(t('copiedLink'))
    } catch {
      const input = document.createElement('textarea')
      input.value = referralLink
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
      notify(t('copiedLink'))
    }
  }

  const shareReferral = () => {
    if (!referralLink) return notify(t('referralUnavailable'))
    const message = lang === 'ar' ? 'انضم إلى Easy Gram واجمع Coins من المهام والتعدين!' : 'Join Easy Gram and collect Coins from tasks and mining!'
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(message)}`
    const tg = (window as any).Telegram?.WebApp
    if (tg?.openTelegramLink) tg.openTelegramLink(shareUrl)
    else window.open(shareUrl, '_blank', 'noopener,noreferrer')
  }

  const navItems = useMemo(() => [
    { id: 'home' as Page, label: t('home'), icon: House },
    { id: 'tasks' as Page, label: t('tasks'), icon: ListChecks },
    { id: 'play' as Page, label: t('play'), icon: Gamepad2 },
    { id: 'withdraw' as Page, label: t('withdraw'), icon: ArrowDownToLine },
    { id: 'profile' as Page, label: t('profile'), icon: UserRound },
  ], [t])

  if (splashVisible) return <LoadingScreen progress={splashProgress} lang={lang} fading={splashFading} />

  if (!telegramInitData()) {
    return <div className="auth-screen" dir={dir}>
      <div className="auth-card">
        <div className="brand-mark large">EG</div>
        <p className="eyebrow">EASY GRAM</p>
        <h1>{t('openTelegram')}</h1>
        <p>{t('openTelegramDesc')}</p>
        <div className="auth-tip"><LockKeyhole size={18} /><span>{lang === 'ar' ? 'تسجيل الدخول يتم تلقائياً عبر تيليجرام.' : 'Sign-in is verified automatically by Telegram.'}</span></div>
        <button className="primary-btn full" onClick={() => changeLanguage(lang === 'ar' ? 'en' : 'ar')}><Globe2 size={18} /> {lang === 'ar' ? 'English' : 'العربية'}</button>
      </div>
    </div>
  }

  if (requiredChannels.some((channel) => !channel.isMember)) return <div className="subscription-screen" dir={dir}>
    <div className="brand-mark large">EG</div><p className="eyebrow">EASY GRAM</p><h1>{t('joinRequired')}</h1><p className="subscription-desc">{t('joinRequiredDesc')}</p>
    <div className="required-channel-list">{requiredChannels.filter((channel) => !channel.isMember).map((channel) => <div className="required-channel" key={channel.id}><div className="required-channel-icon"><Users size={20}/></div><div className="required-channel-info"><strong>{channel.title}</strong>{channel.checkError && <small>{channel.checkError}</small>}</div><a href={channel.joinUrl} target="_blank" rel="noreferrer">{lang === 'ar' ? 'انضمام' : 'Join'} <ArrowUpRight size={14}/></a></div>)}</div>
    <button className="primary-btn full" disabled={checkingMembership} onClick={() => void checkMembership()}>{checkingMembership ? <span className="spinner light"/> : <RefreshCw size={17}/>} {checkingMembership ? t('membershipChecking') : t('checkMembership')}</button>
    <button className="language-link" onClick={() => changeLanguage(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
  </div>

  if (settings.maintenance_mode) return <div className="maintenance-screen" dir={dir}><div className="brand-mark">EG</div><h2>{t('maintenance')}</h2></div>

  return <div className={`app-shell ${lang === 'ar' ? 'rtl' : ''}`} dir={dir}>
    <div className="app-bg" aria-hidden="true"><div className="app-bg__stars app-bg__stars--a" /><div className="app-bg__stars app-bg__stars--b" /></div>
    <header className="topbar">
      <div className="brand-lockup">
        <div className="brand-mark">EG</div>
        <div><strong>Easy Gram</strong><small>{t('footer')}</small></div>
      </div>
      <div className="top-actions">
        <button className="language-btn" onClick={() => changeLanguage(lang === 'ar' ? 'en' : 'ar')} aria-label="Change language"><Globe2 size={17} /><span>{lang === 'ar' ? 'EN' : 'عربي'}</span></button>
        {user?.photoUrl ? <img className="avatar" src={user.photoUrl} alt="" /> : <div className="avatar fallback-avatar"><UserRound size={18} /></div>}
      </div>
    </header>

    <main className="page-content">
      {error && <div className="inline-alert"><CircleHelp size={18} /><span>{error}</span><button onClick={refreshAccount}>{t('refresh')}</button></div>}

      {page === 'home' && user && <>
        <section className="welcome-row">
          <div><p className="eyebrow">{t('hello')},</p><h1>{user.firstName || 'Gram User'}</h1><p>{settings.welcome_text || t('welcome')}</p></div>
          <div className="welcome-bubble"><Gift size={28} /></div>
        </section>
        <section className="balance-card">
          <div className="balance-head"><span>{t('available')}</span><span className="balance-live"><i /> {lang === 'ar' ? 'محدّث' : 'Live'}</span></div>
          <div className="balance-value">{formatCoins(user.coinBalance)} <small>COINS</small></div>
          <div className="balance-usdt-line">{t('usdtBalance')}: <b>{formatUsdt(user.usdtBalance)} USDT</b></div>
          <div className="balance-bottom"><span><Coins size={16} /> {lang === 'ar' ? 'رصيد Easy Gram' : 'Easy Gram balance'}</span><button onClick={() => changePage('withdraw')}>{t('withdraw')} <ArrowRight size={15} /></button></div>
        </section>
        <section className="quick-grid">
          <button className="quick-tile" onClick={() => changePage('tasks')}><span className="quick-ico"><ListChecks size={20} /></span>{lang === 'ar' ? 'المهام' : 'Tasks'}</button>
          <button className="quick-tile" onClick={() => changePage('play')}><span className="quick-ico"><Gamepad2 size={20} /></span>{lang === 'ar' ? 'الألعاب' : 'Arcade'}</button>
          <button className="quick-tile" onClick={() => changePage('profile')}><span className="quick-ico"><Users size={20} /></span>{lang === 'ar' ? 'دعوة' : 'Invite'}</button>
          <button className="quick-tile" onClick={() => changePage('withdraw')}><span className="quick-ico"><Coins size={20} /></span>{t('withdraw')}</button>
        </section>
        <MiningClockCard
          session={miningSession}
          now={clockNow}
          rate={settings.mining_rate_per_hour_coins}
          duration={settings.mining_duration_hours}
          busy={busy === 'mining'}
          onStart={() => void startMining()}
          onClaim={() => void claimMining()}
          t={t}
          lang={lang}
        />
        <section className="stats-grid">
          <div className="stat-card"><div className="stat-icon blue"><ListChecks size={19} /></div><strong>{user.completedTasks}</strong><span>{t('completedTasks')}</span></div>
          <div className="stat-card"><div className="stat-icon green"><Users size={19} /></div><strong>{user.referralsCount}</strong><span>{t('referrals')}</span></div>
        </section>
        <HomeRewardsPreview
          lang={lang}
          onOpenTab={openHubTab}
        />
        <section className="home-referral-card">
          <div className="home-referral-top"><div className="home-referral-icon"><Gift size={19} /></div><div><strong>{t('inviteFriends')}</strong><p>{t('inviteDesc')}</p><small className="referral-rule">{t('referralEligibility').replace('{count}', String(settings.referral_tasks_required))}</small></div><b>+{formatCoins(settings.referral_reward_coins)} COINS</b></div>
          <label>{t('referralLinkLabel')}</label>
          <div className="home-referral-link"><span dir="ltr">{referralLink || t('referralUnavailable')}</span><button onClick={() => void copyReferral()} disabled={!referralLink} aria-label={t('copyLink')}><Copy size={16}/></button></div>
          <button className="home-referral-share" onClick={shareReferral} disabled={!referralLink}><ArrowUpRight size={16}/>{t('shareLink')}</button>
          <div className="referral-status-row"><span>{t('qualifiedReferrals')}: <b>{user.qualifiedReferralsCount || 0}</b></span><span>{t('pendingReferrals')}: <b>{user.pendingReferralsCount || 0}</b></span></div>
        </section>
        <section className="bottom-note"><ShieldCheck size={17} /><span>{lang === 'ar' ? 'المكافآت والطلبات تظهر مباشرة في حسابك.' : 'Rewards and requests are tracked in your account.'}</span></section>
      </>}

      {page === 'tasks' && <>
        <div className="page-title-row"><div><p className="eyebrow">EASY GRAM</p><h1>{t('taskTitle')}</h1><p>{t('taskSubtitle')}</p></div><div className="title-icon"><ListChecks size={23} /></div></div>
        <div className="task-list">
          {tasks.length === 0 && <div className="empty-state"><div className="empty-icon"><ListChecks size={25} /></div><strong>{t('noTasks')}</strong></div>}
          {tasks.map((task) => {
            const finished = task.kind !== 'ad' && task.remaining === 0
            const cooldownSeconds = task.kind === 'ad' && task.next_available_at
              ? Math.max(0, Math.ceil((Date.parse(task.next_available_at) - clockNow) / 1000))
              : 0
            const cooldownLabel = `${String(Math.floor(cooldownSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((cooldownSeconds % 3600) / 60)).padStart(2, '0')}:${String(cooldownSeconds % 60).padStart(2, '0')}`
            const adCycleCompleted = task.kind === 'ad' && task.max_completions > 0 && task.next_available_at && cooldownSeconds === 0
              ? 0
              : task.cycle_completed ?? 0
            const hasSession = Boolean(taskSessions[task.id])
            const taskBusy = busy === `task-${task.id}`
            return <article className={`task-card ${finished ? 'task-finished' : ''}`} key={task.id}>
              <div className="task-card-top"><div className={`task-icon ${task.kind}`}><TaskIcon kind={task.kind} /></div><div className="task-info"><strong>{task.title}</strong><p>{task.description || t(`kind_${task.kind}`)}</p></div><div className="reward-pill">+{formatCoins(task.reward_coins)} <small>COINS</small></div></div>
              <div className="task-card-bottom"><span className="task-kind-label">{t(`kind_${task.kind}`)}{task.kind === 'ad'
                ? task.max_completions > 0
                  ? (lang === 'ar'
                    ? ` · ${task.cycle_completed ?? 0}/${task.max_completions} مشاهدات · انتظار ${task.cooldown_hours} ساعات بعد اكتمالها`
                    : ` · ${task.cycle_completed ?? 0}/${task.max_completions} views · ${task.cooldown_hours}h cooldown after batch`)
                  : (lang === 'ar' ? ' · بدون حد' : ' · Unlimited')
                : task.remaining === null ? ` · ${t('unlimited')}` : ` · ${task.completed}/${task.max_completions}`}</span>
                {finished ? <span className="done-label"><CheckCircle2 size={15} /> {t('completed')}</span> : task.kind === 'ad'
                  ? <button className="small-primary" disabled={taskBusy || cooldownSeconds > 0} onClick={() => void startAd('task', task.id)}>{taskBusy ? <span className="spinner" /> : cooldownSeconds > 0 ? <><Clock3 size={15} /> {t('adAvailableIn')} {cooldownLabel}</> : <><Bell size={15} /> {t('watchAd')}</>}</button>
                  : hasSession
                    ? <button className="small-primary" disabled={taskBusy} onClick={() => void completeTask(task)}>{taskBusy ? <span className="spinner" /> : <><BadgeCheck size={15} /> {t('verify')}</>}</button>
                    : <button className="small-primary" disabled={taskBusy} onClick={() => void openTask(task)}>{taskBusy ? <span className="spinner" /> : <>{t('openTask')} <ArrowUpRight size={15} /></>}</button>}
              </div>
            </article>
          })}
        </div>
      </>}

      {page === 'play' && user && <EarnHub
        lang={lang}
        onBalance={updateCoinBalance}
        onNotify={notify}
        initialTab={hubInitialTab}
        onWatchBonusAd={watchGameBonusAttempt}
      />}

      {page === 'withdraw' && user && <>
        <div className="page-title-row"><div><p className="eyebrow">COINS → USDT</p><h1>{t('withdrawTitle')}</h1><p>{t('withdrawSubtitle')}</p></div><div className="title-icon green-title"><Wallet size={23} /></div></div>
        <section className="withdraw-balance"><div><span>{t('coinBalance')}</span><strong>{formatCoins(user.coinBalance)} <small>COINS</small></strong><p className="balance-usdt-line">{t('usdtBalance')}: <b>{formatUsdt(user.usdtBalance)} USDT</b></p></div><div className="wallet-round"><Wallet size={23} /></div></section>
        <section className="form-card exchange-card">
          <div className="section-heading compact"><div><h2>{t('exchangeTitle')}</h2><p>{t('exchangeHint')}</p></div><span className="method-tag">ADS REQUIRED</span></div>
          <label>{t('exchangeAmount')}<input inputMode="numeric" type="number" min={settings.min_exchange_coins || 1000} step="1" max={user.coinBalance} value={exchangeAmount} onChange={(event) => setExchangeAmount(event.target.value)} placeholder="1000" /></label>
          <div className="exchange-preview"><span>{t('exchangeRate')}</span><b>{formatUsdt((Math.max(0, Number(exchangeAmount) || 0) * 0.0000025))} USDT</b></div>
          <button className="primary-btn full" type="button" disabled={busy === 'exchange' || !Number.isSafeInteger(Number(exchangeAmount)) || Number(exchangeAmount) < (settings.min_exchange_coins || 1000) || Number(exchangeAmount) > user.coinBalance} onClick={() => void exchangeCoins()}>
            {busy === 'exchange' ? <span className="spinner light" /> : <><Bell size={17} /> {t('exchangeButton')}</>}
          </button>
          <p className="hint-text">{lang === 'ar' ? 'كل عملية تحويل تحتاج إعلاناً واحداً يتم التحقق منه من السيرفر. السعر ثابت مثل SLYMintX.' : 'Each exchange requires one server-verified ad. The rate is fixed to match SLYMintX.'}</p>
        </section>
        <section className="ads-progress-card">
          <div className="progress-heading"><div><strong>{t('withdrawalProgress')}</strong><p>{user.withdrawalAdsRequired} {t('adsToUnlock')}</p></div><b>{Math.min(user.withdrawalAdsWatched, user.withdrawalAdsRequired)}/{user.withdrawalAdsRequired}</b></div>
          <div className="progress-track"><div style={{ width: `${Math.min(100, (user.withdrawalAdsWatched / Math.max(1, user.withdrawalAdsRequired)) * 100)}%` }} /></div>
          <button className="secondary-btn full" disabled={busy === 'withdrawal-ad'} onClick={() => void startAd('withdrawal')}>
            {busy === 'withdrawal-ad' ? <span className="spinner" /> : <><Bell size={17} /> {t('watchWithdrawalAd')}</>}
          </button>
          <p className="hint-text">{lang === 'ar' ? 'شاهد الإعلان لمدة 5 ثوانٍ على الأقل. أول سحبة تحتاج 10 إعلانات، وكل سحبة بعدها في نفس اليوم تحتاج 10 إعلانات إضافية.' : 'Watch each ad for at least 5 seconds. The first daily withdrawal needs 10 ads; each additional withdrawal that day needs 10 more.'}</p>
        </section>
        <section className="form-card">
          <div className="section-heading compact"><div><h2>{lang === 'ar' ? 'طلب سحب جديد' : 'New withdrawal'}</h2><p>{t('minWithdrawal')}: {settings.min_withdrawal_usdt}–{settings.max_withdrawal_usdt} USDT</p></div><span className="method-tag">USDT</span></div>
          {!settings.gram_withdrawals_enabled ? <div className="inline-alert">{lang === 'ar' ? 'السحب متوقف حالياً.' : 'Withdrawals are currently disabled.'}</div> : <form onSubmit={submitWithdrawal}>
            <label>{t('amount')}<input inputMode="decimal" type="number" min={settings.min_withdrawal_usdt} max={settings.max_withdrawal_usdt} step="0.0001" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.10" required /></label>
            <label>{t('method')}<select value={withdrawalMethod} onChange={(event) => setWithdrawalMethod(event.target.value as 'binance' | 'gram')}><option value="binance">{t('binance')}</option><option value="gram">{t('gramAddress')}</option></select></label>
            <label>{withdrawalMethod === 'binance' ? t('binance') : t('gramAddress')}<input value={walletAddress} onChange={(event) => setWalletAddress(event.target.value)} placeholder={withdrawalMethod === 'binance' ? 'Binance Pay ID' : 'GRAM / TON wallet address'} autoComplete="off" required /></label>
            <button className="primary-btn full" type="submit" disabled={busy === 'submit-withdrawal' || user.withdrawalAdsWatched < user.withdrawalAdsRequired || user.usdtBalance < Number(amount || 0)}>
              {busy === 'submit-withdrawal' ? <span className="spinner light" /> : <><ArrowDownToLine size={18} /> {t('submit')}</>}
            </button>
            {user.withdrawalAdsWatched < user.withdrawalAdsRequired && <p className="hint-text centered">{lang === 'ar' ? `أكمل ${user.withdrawalAdsRequired - user.withdrawalAdsWatched} إعلانات أخرى لفتح السحب.` : `Watch ${user.withdrawalAdsRequired - user.withdrawalAdsWatched} more ads to unlock withdrawal.`}</p>}
            {user.usdtBalance < Number(amount || 0) && <p className="hint-text centered">{t('balanceTooLow')}</p>}
          </form>}
        </section>
        <div className="section-heading history-heading"><div><h2>{t('history')}</h2></div><button className="icon-button" onClick={() => void loadWithdrawals()}><Clipboard size={17} /></button></div>
        <div className="history-list">
          {withdrawals.length === 0 ? <p className="muted-empty">{t('noHistory')}</p> : withdrawals.map((withdrawal) => <div className="history-item" key={withdrawal.id}><div><strong>{formatUsdt(withdrawal.amount_usdt)} USDT</strong><small>{dateLabel(withdrawal.created_at)} · {withdrawal.method.toUpperCase()} · {withdrawal.target.slice(0, 12)}…</small></div><span className={`status-chip ${withdrawal.status}`}>{withdrawal.status === 'pending' ? t('pending') : withdrawal.status === 'completed' ? t('paid') : t('rejected')}</span></div>)}
        </div>
      </>}

      {page === 'profile' && user && <>
        <div className="page-title-row"><div><p className="eyebrow">EASY GRAM</p><h1>{t('profileTitle')}</h1><p>{lang === 'ar' ? 'إدارة حسابك ومشاركة رابط الدعوة.' : 'Manage your account and share your invite link.'}</p></div><div className="title-icon"><UserRound size={23} /></div></div>
        <section className="profile-card"><div className="profile-avatar">{user.photoUrl ? <img src={user.photoUrl} alt="" /> : <UserRound size={29} />}</div><div><strong>{user.firstName || 'Gram User'}</strong><span>{user.username ? `@${user.username}` : `ID ${user.telegramId}`}</span></div><div className="verified-mark"><Check size={15} /></div></section>
        <section className="details-card"><h2>{t('account')}</h2><div className="detail-line"><span>{t('telegramId')}</span><strong>{user.telegramId}</strong></div><div className="detail-line"><span>{t('joined')}</span><strong>{user.createdAt ? dateLabel(user.createdAt) : '—'}</strong></div><div className="detail-line"><span>{t('language')}</span><strong>{lang === 'ar' ? 'العربية' : 'English'}</strong></div><div className="detail-line"><span>{t('coinBalance')}</span><strong>{formatCoins(user.coinBalance)} COINS</strong></div><div className="detail-line"><span>{t('usdtBalance')}</span><strong>{formatUsdt(user.usdtBalance)} USDT</strong></div>{user.legacyGramBalance ? <div className="detail-line"><span>Legacy GRAM</span><strong>{formatGram(user.legacyGramBalance)} GRAM</strong></div> : null}</section>
        <section className="invite-card">
          <div className="invite-header"><div className="invite-icon"><Gift size={20} /></div><div><strong>{t('inviteFriends')}</strong><p>{t('inviteDesc')}</p></div></div>
          <div className="invite-reward"><span>{lang === 'ar' ? 'مكافأة الإحالة لكل صديق' : 'Reward per invited friend'}</span><b>+{formatCoins(settings.referral_reward_coins)} COINS</b></div>
          <label className="invite-link-label">{t('referralLinkLabel')}</label>
          <div className="invite-link-row"><span dir="ltr">{referralLink || t('referralUnavailable')}</span><button disabled={!referralLink} onClick={() => void copyReferral()} aria-label={t('copyLink')}><Copy size={16}/></button></div>
          <div className="invite-actions"><button className="primary-btn" disabled={!referralLink} onClick={() => void copyReferral()}><Copy size={16} /> {t('copyLink')}</button><button className="secondary-btn" disabled={!referralLink} onClick={shareReferral}><ArrowUpRight size={16} /> {t('shareLink')}</button></div>
        </section>
        <div className="profile-links">
          {settings.support_username && <a href={`https://t.me/${settings.support_username.replace('@', '')}`} target="_blank" rel="noreferrer"><CircleHelp size={18} /> {t('support')} <ArrowUpRight size={15} /></a>}
          {settings.terms_url && <a href={settings.terms_url} target="_blank" rel="noreferrer"><Clipboard size={18} /> {t('terms')} <ArrowUpRight size={15} /></a>}
          {user && <button onClick={() => changeLanguage(lang === 'ar' ? 'en' : 'ar')}><Globe2 size={18} /> {lang === 'ar' ? 'English' : 'العربية'} <ArrowRight size={15} /></button>}
          {(window as any).__easyGramIsAdmin === true && <a href="/admin"><ShieldCheck size={18} /> {t('adminPanel')} <ArrowUpRight size={15} /></a>}
        </div>
      </>}
    </main>

    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => changePage(id)}><Icon size={20} strokeWidth={page === id ? 2.4 : 1.8} /><span>{label}</span></button>)}
      {/** The admin entry is only rendered for an authenticated administrator. */}
      {user && <AdminNav initData={telegramInitData()} onOpen={() => { window.location.href = '/admin' }} lang={lang} />}
    </nav>
    {user && settings.adsgram_native_task_block && settings.adsgram_native_task_reward_coins > 0 && <NativeTaskPopup
      blockId={settings.adsgram_native_task_block}
      rewardCoins={settings.adsgram_native_task_reward_coins}
      lang={lang}
      onReward={(reward, balance) => {
        setUser((current) => current ? { ...current, coinBalance: balance } : current)
        notify(lang === 'ar' ? `تمت إضافة ${formatCoins(reward)} COINS إلى رصيدك!` : `${formatCoins(reward)} COINS added to your balance!`)
      }}
    />}
    {toast && <div className="toast-message"><CheckCircle2 size={17} /> {toast}</div>}
  </div>
}


function MiningClockCard({ session, now, rate, duration, busy, onStart, onClaim, t, lang }: {
  session: MiningSession | null; now: number; rate: number; duration: number; busy: boolean;
  onStart: () => void; onClaim: () => void; t: (key: string) => string; lang: Lang
}) {
  const started = session ? Date.parse(session.started_at) : 0
  const ends = session ? Date.parse(session.ends_at) : 0
  const remainingMs = session ? Math.max(0, ends - now) : 0
  const totalMs = session ? Math.max(1, ends - started) : Math.max(1, duration * 3600000)
  const elapsedMs = session ? Math.min(totalMs, Math.max(0, now - started)) : 0
  const progress = session ? Math.min(100, (elapsedMs / totalMs) * 100) : 0
  const expected = session ? Number(session.rate_per_hour) * Number(session.duration_hours) : Number(rate) * Number(duration)
  const liveReward = session ? Math.min(expected, Number(session.rate_per_hour) * elapsedMs / 3600000) : 0
  const formatTime = (ms: number) => {
    const sec = Math.max(0, Math.floor(ms / 1000))
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  }
  return <section className={`mining-card ${session ? 'is-running' : ''}`}>
    <div className="mining-card-heading"><div><span className="eyebrow">EASY GRAM · COIN MINER</span><h2>{t('mining')}</h2><p>{t('miningDesc')}</p></div><div className="mining-spark"><Sparkles size={20}/></div></div>
    <div className="mining-main"><div className="clock-wrap"><svg className="clock-progress" viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="rgba(154,92,240,.18)" strokeWidth="7"/><circle cx="60" cy="60" r="52" fill="none" stroke="#9a5cf0" strokeWidth="7" strokeLinecap="round" strokeDasharray={String(2*Math.PI*52)} strokeDashoffset={String(2*Math.PI*52*(1-progress/100))} transform="rotate(-90 60 60)"/></svg><div className="clock-face"><Clock3 size={44}/><span>{session ? (remainingMs === 0 ? '00:00' : formatTime(remainingMs)) : `${duration}h`}</span></div></div>
      <div className="mining-readout"><span>{session ? (remainingMs === 0 ? t('miningReady') : t('miningActive')) : t('miningDuration')}</span><strong>{session ? <>{formatCoins(liveReward)} <small>/ {formatCoins(expected)} COINS</small></> : `${duration} ${lang === 'ar' ? 'ساعات' : 'hours'}`}</strong><div className="mining-meter"><i style={{width:`${session ? progress : 0}%`}}/></div><small>{t('miningRate')}: {formatCoins(session?.rate_per_hour ?? rate)} COINS · {t('miningTotalReward')}: {formatCoins(expected)} COINS</small></div></div>
    <div className="mining-card-footer"><div><span>{t('miningTimeLeft')}</span><b>{session ? formatTime(remainingMs) : '—'}</b></div>{!session ? <button className="primary-btn" disabled={busy} onClick={onStart}>{busy ? <span className="spinner light"/> : <Timer size={16}/>} {t('miningStart')}</button> : remainingMs > 0 ? <button className="primary-btn" disabled>{t('miningActive')}</button> : <button className="primary-btn claim" disabled={busy} onClick={onClaim}>{busy ? <span className="spinner light"/> : <Coins size={16}/>} {t('miningClaim')}</button>}</div>
  </section>
}

function AdminNav({ initData, onOpen, lang }: { initData: string; onOpen: () => void; lang: Lang }) {
  const [isAdmin, setIsAdmin] = useState(false)
  useEffect(() => {
    if (!initData) return
    const headers = { Authorization: `tga ${initData}`, 'X-Telegram-Init-Data': initData }
    fetch('/api/admin', { headers }).then((response) => {
      if (response.ok) setIsAdmin(true)
    }).catch(() => undefined)
  }, [initData])
  if (!isAdmin) return null
  return <button onClick={onOpen}><ShieldCheck size={20} /><span>{lang === 'ar' ? 'الإدارة' : 'Admin'}</span></button>
}
