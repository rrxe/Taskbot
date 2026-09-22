/* ==========================================================
   Rocket — lightweight i18n (English default, Arabic toggle)
   No build step / no framework: a plain dictionary + a couple
   of DOM helpers. Persisted per-device in localStorage.
   ========================================================== */

const I18N = {
  en: {
    loading: 'Loading…',
    error_generic: "Couldn't load data.",
    retry: 'Try again',
    load_error_generic: "Couldn't load data, check your connection and try again.",
    open_in_telegram: 'Open this app from inside Telegram.',
    account_suspended: 'Your account is suspended. Contact support.',

    welcome_sub: "Welcome 👋 we're glad you're here",
    choose_country: 'Choose your country',
    choose_country_desc: "This is used to set your ad earnings rate. It can't be changed later except through support.",
    confirm_country: 'Confirm country',
    no_countries: 'No countries available right now, please try again later.',

    balance_available: 'Available balance',
    total_paid_label: 'Total paid:',
    today_impressions_label: 'Views today',
    today_earnings_label: 'Earnings today',
    watch_ad_desc: 'Watch a full ad to earn a reward',
    watch_ad_btn: 'Watch ad',
    pending_label: 'Pending',

    trust_countries: 'Multi-country',
    trust_payouts: 'Verified payouts',
    trust_transparency: 'Full transparency',
    version_label: 'Version 1.0.0',

    nav_home: 'Home',
    nav_withdraw: 'Withdraw',
    nav_history: 'History',
    nav_leaderboard: 'Leaderboard',

    withdraw_locked_title: 'Withdrawals are closed',
    withdraw_locked_desc: "The admin team will open withdrawals soon. Keep an eye on your balance from the Home tab.",
    withdrawable_balance: 'Withdrawable balance',
    amount_placeholder: 'Amount',
    wallet_placeholder: 'Wallet address',
    submit_withdraw: 'Submit withdrawal',
    withdraw_history_title: 'Previous withdrawal requests',
    no_withdraw_history: 'No previous requests',
    status_pending: 'Under review',
    status_approved: 'Approved',
    status_paid: 'Paid',
    status_rejected: 'Rejected',

    no_history: 'No history yet',
    views_suffix: 'views',

    ads_not_live_notice: "Ads are not live yet — we're waiting on AdsGram to activate this app's ad blocks. The leaderboard will start filling up as soon as ads go live.",
    leaderboard_heading: '🏆 Top Viewers This Month',
    leaderboard_empty: 'Soon player will be here',
    you_suffix: ' (You)',

    toast_load_failed: "Couldn't load data",
    toast_generic_error: 'Something went wrong, please try again',
    toast_view_recorded_pending: "View recorded — today's rate isn't set yet",
    toast_earnings_added: 'Your earnings were added 🎉',
    toast_confirm_failed: 'Could not confirm the view',
    note_ads_disabled: 'Reward ads are not enabled yet (the block hasn\'t been created on AdsGram).',
    note_please_wait_ad: 'Please wait a moment before watching another ad.',
    note_ad_incomplete: 'The ad was not completed.',
    note_wait_seconds: 'Please wait {sec}s before trying again',
    note_daily_limit: "You've reached today's ad limit",
    note_ad_start_failed: "Couldn't start the ad, try again later",

    toast_fill_fields: 'Please fill in all fields',
    toast_withdraw_success: 'Withdrawal request submitted successfully',
    err_withdrawals_locked: 'Withdrawals are currently closed',
    err_amount_below_minimum: 'Amount is below the minimum allowed',
    err_insufficient_balance: 'Insufficient balance',
    err_missing_payment_details: 'Please fill in all fields',
    err_invalid_method: 'Withdrawal method not supported',
    toast_withdraw_failed: "Couldn't submit the request",
  },
  ar: {
    loading: 'جارٍ التحميل…',
    error_generic: 'تعذر تحميل البيانات.',
    retry: 'إعادة المحاولة',
    load_error_generic: 'تعذر تحميل البيانات، تحقق من الاتصال ثم أعد المحاولة.',
    open_in_telegram: 'افتح التطبيق من داخل تيليجرام.',
    account_suspended: 'حسابك موقوف. تواصل مع الدعم.',

    welcome_sub: 'أهلاً بك 👋 نحن سعداء بانضمامك',
    choose_country: 'اختر دولتك',
    choose_country_desc: 'يُستخدم هذا لتحديد قيمة الإعلانات الخاصة بدولتك. لا يمكن تغييره لاحقًا إلا عبر الدعم.',
    confirm_country: 'تأكيد الدولة',
    no_countries: 'لا توجد دول متاحة حاليًا، حاول لاحقًا.',

    balance_available: 'الرصيد المتاح',
    total_paid_label: 'إجمالي المدفوع:',
    today_impressions_label: 'مشاهدات اليوم',
    today_earnings_label: 'أرباح اليوم',
    watch_ad_desc: 'شاهد إعلانًا كاملاً لتحصل على مكافأة',
    watch_ad_btn: 'مشاهدة إعلان',
    pending_label: 'قيد الانتظار',

    trust_countries: 'دعم متعدد الدول',
    trust_payouts: 'مدفوعات موثّقة',
    trust_transparency: 'شفافية كاملة',
    version_label: 'الإصدار 1.0.0',

    nav_home: 'الرئيسية',
    nav_withdraw: 'السحب',
    nav_history: 'السجل',
    nav_leaderboard: 'المتصدرون',

    withdraw_locked_title: 'السحب مغلق حاليًا',
    withdraw_locked_desc: 'سيتم فتح السحب من قبل الإدارة قريبًا. تابع رصيدك من الصفحة الرئيسية.',
    withdrawable_balance: 'الرصيد القابل للسحب',
    amount_placeholder: 'المبلغ',
    wallet_placeholder: 'عنوان المحفظة',
    submit_withdraw: 'إرسال طلب السحب',
    withdraw_history_title: 'طلبات السحب السابقة',
    no_withdraw_history: 'لا توجد طلبات سابقة',
    status_pending: 'قيد المراجعة',
    status_approved: 'تمت الموافقة',
    status_paid: 'تم الدفع',
    status_rejected: 'مرفوض',

    no_history: 'لا يوجد سجل بعد',
    views_suffix: 'مشاهدة',

    ads_not_live_notice: 'الإعلانات غير مفعّلة بعد — بانتظار قيام AdsGram بتفعيل بلوكات الإعلانات لهذا التطبيق. ستبدأ لوحة المتصدرين بالامتلاء فور تفعيل الإعلانات.',
    leaderboard_heading: '🏆 الأكثر مشاهدة هذا الشهر',
    leaderboard_empty: 'قريبًا سيظهر اللاعبون هنا',
    you_suffix: ' (أنت)',

    toast_load_failed: 'تعذر تحميل البيانات',
    toast_generic_error: 'حدث خطأ، حاول مجددًا',
    toast_view_recorded_pending: 'تم تسجيل المشاهدة، بانتظار تحديد سعر اليوم',
    toast_earnings_added: 'تمت إضافة أرباحك 🎉',
    toast_confirm_failed: 'تعذر تأكيد المشاهدة',
    note_ads_disabled: 'إعلانات المكافأة غير مفعّلة بعد (لم يتم إنشاء البلوك من AdsGram).',
    note_please_wait_ad: 'الرجاء الانتظار قليلًا قبل مشاهدة إعلان آخر.',
    note_ad_incomplete: 'لم تكتمل مشاهدة الإعلان.',
    note_wait_seconds: 'الرجاء الانتظار {sec} ثانية قبل المحاولة مجددًا',
    note_daily_limit: 'لقد وصلت للحد اليومي من الإعلانات',
    note_ad_start_failed: 'تعذر بدء الإعلان، حاول لاحقًا',

    toast_fill_fields: 'يرجى تعبئة جميع الحقول',
    toast_withdraw_success: 'تم إرسال طلب السحب بنجاح',
    err_withdrawals_locked: 'السحب مغلق حاليًا',
    err_amount_below_minimum: 'المبلغ أقل من الحد الأدنى المسموح',
    err_insufficient_balance: 'الرصيد غير كافٍ',
    err_missing_payment_details: 'يرجى تعبئة جميع الحقول',
    err_invalid_method: 'طريقة السحب غير مدعومة',
    toast_withdraw_failed: 'تعذر إرسال الطلب',
  },
};

let currentLang = localStorage.getItem('rocket_lang') || 'en';
if (!I18N[currentLang]) currentLang = 'en';

function t(key, vars) {
  let str = (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      str = str.replace(`{${k}}`, vars[k]);
    });
  }
  return str;
}

function getLang() {
  return currentLang;
}

function applyDocumentDirection() {
  document.documentElement.lang = currentLang;
  document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
}

function translateStaticEls() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
  });
  const toggle = document.getElementById('lang-toggle');
  if (toggle) toggle.textContent = currentLang === 'ar' ? 'EN' : 'AR';
}

// Sets the language, updates dir/lang + static text, then lets the
// caller (app.js) re-render whatever dynamic content is cached.
function setLang(lang, onChanged) {
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem('rocket_lang', lang);
  applyDocumentDirection();
  translateStaticEls();
  if (typeof onChanged === 'function') onChanged();
}

applyDocumentDirection();
translateStaticEls();
