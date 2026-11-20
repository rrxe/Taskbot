# تحديث Easy Gram: Coins + USDT

## القواعد الجديدة

- سعر التحويل مطابق لـ SLYMintX: `1 Coin = 0.0000025 USDT`، لذلك `2,000 Coins = 0.005 USDT`.
- الحد الأدنى للتحويل `1,000 Coins`، وكل عملية تحويل تتطلب إعلان AdsGram Reward موثّقاً من السيرفر.
- السحب من `0.1` إلى `0.2 USDT` لكل طلب، إلى Binance أو BNB.
- أول طلب سحب في اليوم يتطلب 10 إعلانات؛ كل طلب إضافي في اليوم نفسه يتطلب 10 إعلانات إضافية.
- المهام والتعدين والإحالات وAdsGram Native Task تضيف Coins إلى المحفظة الجديدة. جلسات التعدين النشطة القديمة تتحول إلى مقياس Coins مرة واحدة عند تطبيق SQL؛ الجلسات المكتملة التاريخية لا تتغير.
- رصيد GRAM القديم وسجل سحوباته محفوظان كما هما، ولا يتم تحويل أرصدة المستخدمين القديمة تلقائياً.

## ترتيب تطبيق قاعدة البيانات

1. خذ نسخة احتياطية من Supabase أولاً.
2. تأكد أن قاعدة Easy Gram تحتوي على المخطط الأساسي `sql_easygram.sql` وتحديث AdsGram/Mining `EasyGram_SLY_AdsMining_AllInOne.sql`.
3. افتح Supabase → SQL Editor، والصق كامل ملف `easygram_coins_usdt_migration.sql` ثم Run.
4. ارفع ملفات المشروع الجديدة وشغّل `npm ci` ثم `npm run build` ثم `npm start` (أو أعد بناء Docker image إذا كان النشر عبر Docker).
5. من لوحة الإدارة تأكد من ضبط AdsGram Reward INT block الصحيح. التحويل والمهام والتعدين والسحب تستخدم هذا البلوك.

## ملاحظة الأرصدة القديمة

يضيف التحديث محافظ Coins وUSDT جديدة تبدأ بصفر للمستخدمين الحاليين والجدد. لا يغيّر `balance_gram` القديم ولا يلمس تاريخ السحب القديم. ملف SQL يحتوي في آخره على مثال اختياري معلّق لتحويل رصيد GRAM القديم إلى Coins بضربه في `1,000,000`؛ لا تفعّله إلا بعد مراجعة المبالغ والتأكد من رغبتك في ترحيلها.

## الملفات المعدّلة

- `api/exchange.js`: تحويل Coins إلى USDT بعد إعلان موثّق.
- `api/withdraw.js`: سجل وطلبات سحب USDT إلى Binance أو BNB.
- `api/ads/pulse.js`: موضع إعلان التحويل وتأكيد المشاهدة.
- `api/auth/me.js`, `api/tasks/index.js`, `api/mining.js`: ربط المكافآت بمحفظة Coins.
- `api/admin/index.js`, `public/admin.html`: إدارة مكافآت Coins وطلبات USDT.
- `src/App.tsx`, `src/lib/ads.ts`, `src/components/NativeTaskPopup.tsx`: واجهة Coins/USDT والإعلانات.
