# إصلاح خطأ started_at is ambiguous

شغّل ملف `EasyGram_Fix_StartedAt_Ambiguous.sql` داخل Supabase SQL Editor بعد التحديث السابق.

السبب: دالتا `easygram_claim_mining` و`easygram_claim_mining_with_ad` تعيدان عمود OUT اسمه `started_at`، وكان الاستعلام يستخدم `started_at` دون تحديد الجدول. عالج الإصلاح ذلك باستخدام أسماء مستعارة واضحة (`mining_row` و`ad_row`). لا يحذف جلسات التعدين ولا يغيّر الأرصدة.
