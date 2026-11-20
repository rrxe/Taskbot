type LoadingScreenProps = {
  progress: number
  lang: 'ar' | 'en'
  fading?: boolean
}

export default function LoadingScreen({ progress, lang, fading = false }: LoadingScreenProps) {
  const value = Math.min(100, Math.max(0, progress))
  const stage = value < 27 ? 0 : value < 55 ? 1 : value < 82 ? 2 : value < 100 ? 3 : 4
  const arabic = lang === 'ar'
  const stages = arabic
    ? ['جارٍ الاتصال بالخدمة', 'جارٍ تأمين الجلسة', 'جارٍ تحميل المهام والمحفظة', 'جارٍ ترتيب مساحتك', 'كل شيء جاهز']
    : ['CONNECTING TO EASY GRAM', 'SECURING YOUR SESSION', 'LOADING TASKS & WALLET', 'SETTING UP YOUR SPACE', 'READY WHEN YOU ARE']

  return (
    <div className={`eg-intro${fading ? ' eg-intro--fading' : ''}`} dir={arabic ? 'rtl' : 'ltr'}>
      <div className="eg-intro__glow eg-intro__glow--top" />
      <div className="eg-intro__glow eg-intro__glow--bottom" />

      <header className="eg-intro__topbar">
        <div className="eg-intro__identity">
          <span className="eg-intro__mini-mark">EG</span>
          <span>EASY GRAM</span>
        </div>
        <div className="eg-intro__secure"><i />{arabic ? 'جلسة آمنة' : 'SECURE SESSION'}</div>
      </header>

      <main className="eg-intro__main">
        <div className="eg-intro__seal-wrap" aria-hidden="true">
          <div
            className="eg-intro__progress-ring"
            style={{ background: `conic-gradient(from -90deg, #6EAE79 ${value * 3.6}deg, rgba(255,255,255,.075) 0deg)` }}
          />
          <div className="eg-intro__seal">
            <span>EG</span>
            <i />
          </div>
        </div>

        <p className="eg-intro__eyebrow">{arabic ? 'مساحتك اليومية للمكافآت' : 'YOUR DAILY REWARD SPACE'}</p>
        <h1 className="eg-intro__wordmark"><span>Easy</span> <b>Gram</b></h1>
        <p className="eg-intro__tagline">
          {arabic ? 'مهام بسيطة. خطوات واضحة. مكافآت لك.' : 'Simple tasks. Clear steps. Rewards that add up.'}
        </p>

        <section className="eg-intro__loading" aria-label={arabic ? 'حالة التحميل' : 'Loading status'}>
          <div className="eg-intro__loading-head">
            <span><i />{stages[stage]}</span>
            <strong>{Math.round(value)}%</strong>
          </div>
          <div
            className="eg-intro__bar"
            role="progressbar"
            aria-valuenow={Math.round(value)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={arabic ? 'تقدم التحميل' : 'Loading progress'}
          >
            <span style={{ width: `${value}%` }} />
          </div>
          <div className="eg-intro__loading-foot">
            <span>{arabic ? 'يتم تجهيز حسابك' : 'PREPARING YOUR ACCOUNT'}</span>
            <b>0{stage + 1} <i>/</i> 05</b>
          </div>
        </section>
      </main>

      <footer className="eg-intro__footer">
        <span>{arabic ? 'تجربة هادئة، من البداية.' : 'A calmer way to collect Gram.'}</span>
        <span className="eg-intro__footer-dot" />
        <span>EST. EASY GRAM</span>
      </footer>
    </div>
  )
}
