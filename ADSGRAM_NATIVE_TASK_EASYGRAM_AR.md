# AdsGram Native Task — Easy Gram

## التفعيل

1. شغّل `easygram_adsgram_native_task_migration.sql` مرة واحدة في Supabase SQL Editor.
2. في متغيرات بيئة السيرفر (Dokploy) أضف `ADSGRAM_REWARD_SECRET` واجعل قيمته السر الجديد المتفق عليه. لا تضف السر إلى React أو ملفات الواجهة.
3. في منصة AdsGram اجعل **Web app URL** هو رابط Easy Gram: `https://taskbot-m3xnev-fdde75-77-90-13-215.sslip.io/`.
4. أنشئ بلوكاً واحداً من النوع **Task** ثم ضع Reward URL الذي يرسله هذا الملف في إعدادات البلوك.
5. افتح Easy Gram Admin → Settings → AdsGram Native Task، واكتب Block ID بصيغة `task-0000` وحدد مكافأة GRAM. القيمة الافتراضية `0.01 GRAM`.

## Reward URL

استبدل `YOUR_SECRET` بنفس قيمة `ADSGRAM_REWARD_SECRET` في السيرفر:

`https://taskbot-m3xnev-fdde75-77-90-13-215.sslip.io/api/auth/me?adsgram_reward=1&secret=YOUR_SECRET&userid=[userId]&kind=native_task`

## السلوك

- تظهر نافذة المهمة بعد ثالث ضغطة للمستخدم، مرة واحدة في جلسة التطبيق.
- يمكن إغلاق النافذة دون إكمال المهمة.
- لا تُضاف المكافأة من حدث المتصفح وحده؛ AdsGram يجب أن يستدعي Reward URL أولاً، ثم يطالب التطبيق بالمكافأة من السيرفر.
- عملية المطالبة ذرّية وتستهلك علامة التحقق مرة واحدة.
- اترك Block ID فارغاً من لوحة الإدارة لتعطيل الخاصية.

**ملاحظة:** AdsGram توصي ببلوك Task واحد لكل منصة Mini App. رابط المهمة/الوجهة وإعداد Web app URL يتم ضبطهما في لوحة AdsGram؛ عنصر `<adsgram-task>` يستقبل Block ID فقط.
