# Easy Gram

## مهم: إصلاح AdsGram والتعدين

إذا كانت قاعدة بياناتك قد ثُبّتت سابقاً وتعمل فيها الإعلانات والتعدين، فلا تُعد تشغيل ملف All-in-One. لتحديث آلية مهام الإعلان إلى مجموعات قابلة للضبط (مثل 6 إعلانات ثم انتظار 5 ساعات)، شغّل `easygram_ads_batch_cooldown_migration.sql` مرة واحدة قبل نشر هذه النسخة. راجع `UPDATE_AD_TASK_BATCH_COOLDOWN_AR.md`.

Easy Gram is a Telegram Mini App earning bot built as a clean, standalone project. It is based on the useful account/task/withdrawal patterns from the uploaded SLY project, but it does **not** include the SLY game systems, mining pages, themes, Comet Run, Laser Escape, or SLY branding.

## Included

- User pages: Home, Tasks, Withdraw, Profile.
- Arabic and English interface (language is saved to the user's account).
- Gram balance and one payout method: Gram wallet address.
- Task types: AdsGram INT ad, visit link, join Telegram channel, and open bot.
- Referral links and configurable referral reward.
- Five withdrawal ads by default before every withdrawal request.
- Dedicated AdsGram INT blocks: `int-58010` for automatic impressions and `int-58009` for rewarded ad tasks, withdrawal progress, and mining start/claim. These defaults must be replaced with active IDs from the Easy Gram AdsGram setup.
- Admin panel at `/admin` with task CRUD, withdrawal review, app settings, moderators/permissions, broadcast, member tracking, member suspension and balance adjustments, plus required-channel management.
- A clock-style Gram mining session on the Home page. Default rate is 0.02 GRAM/hour for six hours; the rate and duration are adjustable in Admin → Settings. Rewards are credited only after the session finishes and the user claims them.
- Mandatory channel subscription configurable in Admin → Required channels. Server-side Telegram membership checks gate tasks, mining, ads and withdrawals.
- Owner admin access uses `ADMIN_SECRET` at `/admin`, matching the SLY admin-panel login style. Moderators use Telegram Mini App authentication with database-backed section permissions.
- Supabase SQL schema and RPC functions for task rewards, referrals, and withdrawal balance changes.

## 1. Supabase setup

1. Create a new Supabase project for Easy Gram. Keeping it separate from SLY is recommended.
2. Open **SQL Editor**.
3. Paste and run the complete `sql_easygram.sql` file.
4. When upgrading an already-running installation, also run `WITHDRAWAL_ADS_NO_CLICK_MIGRATION.sql` once so the database RPC stops requiring advertiser clicks for withdrawal ads.
5. Copy the project URL and the `service_role` secret key from Supabase API settings.

Do not put the service-role key in frontend variables. The key is used only by the Node server.

## 2. Environment variables

Copy `.env.example` to `.env` and fill in the values:

```env
NODE_ENV=production
PORT=3000

SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY

TELEGRAM_BOT_TOKEN=123456:YOUR_EASY_GRAM_BOT_TOKEN
# IMPORTANT: this must be the token of the exact Easy Gram bot that opens the Mini App.
# Alternatively, older deployments may use BOT_TOKEN instead.
# BOT_TOKEN=123456:YOUR_BOT_TOKEN
TELEGRAM_INITDATA_MAX_AGE_SECONDS=86400
BOT_USERNAME=your_easygram_bot
WEBAPP_URL=https://your-domain.example
TELEGRAM_WEBHOOK_SECRET=replace_with_a_long_random_secret

ADMIN_SECRET=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET

ADSGRAM_AUTO_BLOCK=int-58010
ADSGRAM_REWARD_BLOCK=int-58009
```

Create a strong `ADMIN_SECRET` (for example with `openssl rand -hex 32`). Open `https://your-domain.com/admin`, enter the same key, and press Test connection. No owner Telegram ID or owner database row is required.

The two AdsGram block IDs are stored in the SQL settings table and can be changed from **Admin → Settings**: Automatic ads block ID is used only for automatic impressions; Reward / action ads block ID is used for rewarded ad tasks, withdrawal progress, and mining start/claim. Use active AdsGram INT block IDs issued for the Easy Gram app/domain.

## 3. Telegram bot setup

1. Create a bot with BotFather and copy its token to `TELEGRAM_BOT_TOKEN`.
2. Set `BOT_USERNAME` without the `@` symbol (used for referral and `/start` links).
3. Set your deployed public Mini App URL in `WEBAPP_URL` using HTTPS. Automatic reminder buttons use Telegram `web_app` buttons and open this URL inside Telegram, not an external browser.
4. Configure the Mini App URL / menu button in BotFather.
5. Deploy the Node server. If `WEBAPP_URL` and `TELEGRAM_WEBHOOK_SECRET` are configured, Easy Gram registers its Telegram webhook automatically at startup.
6. Open the bot and press **Start**, then open the Mini App.

The referral format is `?startapp=ref_TELEGRAM_ID` and is validated from Telegram's signed Mini App data.

## 4. Deploy with Docker / Dokploy

The included `Dockerfile` builds the Vite app and starts the Express API on port `3000`.

- Build context: project root.
- Dockerfile: `Dockerfile`.
- Exposed port: `3000`.
- Add the environment variables from `.env.example` in the deployment dashboard.
- Persist the deployment domain in `WEBAPP_URL`.

Presence tracking sends a lightweight authenticated ping every two minutes while the Mini App is visible. The Admin panel marks a member online when seen within the last five minutes.

Local development:

```bash
npm install
npm run dev
```

Production build and server:

```bash
npm run build
npm start
```

For production, use the Dockerfile or run the build first so the `dist` directory exists.

## 5. Admin panel

Open `/admin` directly in a browser or inside Telegram, enter `ADMIN_SECRET`, and press Test connection. The panel includes:

- **Tasks:** add, edit, pause, activate, and delete tasks; set reward, type, link, completion cap, and order.
- **Withdrawals:** review pending Gram wallet requests, copy wallet addresses, approve payment, or reject and refund the user automatically.
- **Settings:** app name, welcome text, minimum payout, withdrawal ad count, referral reward, required number of different tasks before a referral is paid, task wait, ad cooldown, both AdsGram block IDs, Gram method label/note, support, terms, maintenance mode, and registration switch.
- **Moderators:** add Telegram numeric IDs and assign section permissions. Only the owner can manage moderators.
- **Broadcast:** send an announcement to registered users.
- **Users:** search registered members, see online status (presence ping every two minutes), last seen, registration date and balance; suspend or restore accounts and adjust balances with audit logs.

Moderators cannot grant themselves new permissions or remove the owner. The owner is authenticated with `ADMIN_SECRET`; no owner Telegram ID is configured.

## AdsGram INT behavior and verification note

- Automatic impressions use only `adsgram_auto_block`. Rewarded ad tasks, withdrawal progress, and mining start/claim use only `adsgram_reward_block`. Ordinary link, channel, and bot tasks open directly without an extra ad. The blocks are never alternated. For an existing database, run `sql_easygram_ads_split_migration.sql` after deployment; this migration also repairs the mining placement constraint and installs the atomic ad/mining confirmation functions.
- Task-ad sessions require at least five seconds of displayed ad time.
- Each withdrawal-ad session requires a completed AdsGram view of at least five seconds; opening or clicking the advertiser is not required. Five successful sessions are required by default before a payout can be requested.
- A short server-side pulse/session record, a minimum five-second elapsed time, a cooldown, and a single-use session check are used before counting a rewarded ad. Withdrawal ads do **not** require clicking the advertiser or leaving the Mini App.

**Important limitation:** AdsGram INT is an interstitial format; the current implementation uses client-observed SDK start/completion timing plus server-side elapsed-time and single-use checks. AdsGram does not provide this app with a cryptographic reward receipt in this INT integration, so the check is not a provider-certified proof of a view and cannot fully prevent a modified client from faking browser-side signals.

## Notes

- The only withdrawal method in this version is a Gram wallet address. The included mining feature is a clock-based timed session, not a separate game. Binance, BNB, USDT, and marketplace features are not included.
- Set the Easy Gram bot as an administrator in channels used for join-channel tasks and mandatory subscriptions so Telegram membership can be checked. Use the Easy Gram bot token in Dokploy; an SLY bot token will fail Mini App signature verification. Public channel tasks should include a chat ID such as `@channelname` and a valid join URL; private channels should use their numeric `-100…` chat ID and invite link.
- New tasks and app settings are managed from the admin panel; no source-code edit is needed for routine task or payout-rule changes.
- Test with a small group and test wallets before opening the bot publicly.

## شرح سريع بالعربي

1. أنشئ مشروع Supabase جديداً لـ Easy Gram، ثم افتح SQL Editor والصق ملف `sql_easygram.sql` كاملاً وشغّله مرة واحدة.
2. انسخ `.env.example` إلى ملف باسم `.env` واملأ القيم الحقيقية: رابط Supabase والمفتاح السري، توكن البوت، اسم البوت، رابط التطبيق، ومفتاح الإدارة `ADMIN_SECRET` الذي ستدخله في صفحة `/admin`.
3. لا تضع `SUPABASE_SERVICE_ROLE_KEY` في كود الواجهة أو في متغيرات تبدأ بـ `VITE_`؛ هذا المفتاح يبقى في الخادم فقط.
4. ارفع المشروع إلى Dokploy أو خادم يدعم Docker، واجعل ملف البناء `Dockerfile` والمنفذ `3000`. أضف متغيرات `.env` من لوحة الاستضافة.
5. بعد النشر، اضبط رابط Mini App في BotFather، ثم افتح البوت واضغط Start وافتح التطبيق. افتح `/admin` وأدخل نفس قيمة `ADMIN_SECRET` التي وضعتها في متغيرات الاستضافة.
6. من الإدارة أضف المهام، واضبط إعدادات GRAM ومعرّفي AdsGram INT. عدد إعلانات السحب الافتراضي هو خمسة ويمكن تغييره من الإعدادات.

**مهم:** لا يوفّر تكامل AdsGram INT الحالي إيصال مكافأة مشفّراً يمكن للخادم التحقق منه؛ التحقق يعتمد على حدث بدء/إغلاق SDK ومدة المشاهدة التي يرسلها العميل، إضافةً إلى مدة الجلسة والتحقق من الاستخدام لمرة واحدة في قاعدة البيانات. لذلك لا يُعدّ إثباتاً تشفيرياً كاملاً ضد عميل معدّل. اختبر الإعلانات والسحب قبل الإطلاق العام.


## V3 earning and advertising settings

- Referral links are generated from `BOT_USERNAME`; if it is omitted or left as the example placeholder, the server resolves the bot username through Telegram `getMe`. Set optional `BOT_APP_SHORT_NAME` when the Mini App is a named app (for example `start`) rather than the bot main Mini App.
- Automatic AdsGram interstitials use only the Automatic ads block, start shortly after the user account is loaded and repeat after the configured interval (default 30 seconds). A no-fill/error retries after 10 seconds; AdsGram `onNonStopShow` pauses automatic attempts for 60 seconds.
- Mining start, claim, ad tasks and withdrawal reward ads use the dedicated Reward / action block and require an INT ad view of at least five seconds. Ordinary link/channel/bot tasks open directly, and submitting a withdrawal does not trigger an extra uncounted ad. Withdrawal does not require an advertiser click or app-switch. Task reward ads use their own server-side ad sessions.
- The admin settings page controls mining reward per hour, mining session duration, automatic ad enable/disable and automatic ad interval. Changes to mining settings apply to new sessions; an active session retains its saved rate and duration.
- For existing installations, run `sql_easygram_ads_split_migration.sql`; it copies old block IDs, updates the allowed `mining_start` / `mining_claim` ad-session placements, and installs atomic confirmation/mining functions. The migration is safe to rerun. The full `sql_easygram.sql` also includes these functions for fresh installations.

## V4 behavior update

- Referral links use the configured `BOT_USERNAME`, or fall back to Telegram `getMe` when it is left as the example value. New referral links open the bot chat first with `?start=ref_<telegram_id>` so the user receives the `/start` welcome message. Its button opens the Mini App via `?startapp=ref_<telegram_id>`, preserving the signed referral `start_param`. If the app is configured with a named short name, set `BOT_APP_SHORT_NAME` to that exact short name; leave it blank for the bot's Main Mini App.
- Automatic AdsGram INT ads start shortly after account + required-subscription checks complete, then repeat 30 seconds after a successful show. A no-fill/error retries after 10 seconds. The interval (30–300 seconds) and enable switch are in `/admin` → App settings.
- Mining start, mining claim, withdrawal rewards, and ad tasks use only the shared Reward / action AdsGram INT block and require the ad to be watched for at least five seconds. Withdrawal ads do not require an advertiser click or opening an external page. Automatic interstitials grant no user reward.
- Mining reward per hour and session duration are editable in `/admin` → App settings. A session stores a snapshot of those values when it starts, so changes affect new sessions only. The admin form previews the total payout (`rate × hours`).
- Language preference persists in local storage and the currently selected bottom-navigation page persists for the active WebView session.
- The home dashboard places the mining clock first, with the Gram balance, account stats and referral panel underneath, using the black, electric-blue and mint-green palette.


## V5 update

- UI and admin console now use the black / blue / green Easy Gram palette.
- Withdrawal rewarded ads no longer require a click or opening an advertiser page; the user must watch the AdsGram ad for at least five seconds.
- Referral rewards are now pending at signup and are paid once the invited user completes the configured number of different tasks. The default is 3 and can be changed in Admin → Settings.
- Existing referral rows remain marked as paid by the migration so old rewards are not duplicated. New referrals stay pending until the invited user finishes the configured number of distinct tasks; changing the setting applies to new referrals, while existing pending referrals keep the required count saved at signup.
- Required-channel admin view includes **Test bot access**. The test verifies that Telegram reports the bot itself as an administrator in that channel. Keep the bot as an administrator in every active required channel. The server blocks task, mining, ad-reward and withdrawal endpoints until a user is verified as a member of every active required channel. With no active channels configured, the gate is intentionally inactive.

For an existing V4 database, run `sql_easygram_v5_migration.sql` once (it is safe to rerun) before deploying V5. For a fresh database, run the full `sql_easygram.sql`. Do not run the full setup SQL over an unrelated database. The V5 migration preserves existing users, balances, tasks and withdrawals, and marks old referral rows paid to avoid duplicate rewards.

## Latest update: configurable ad-task batches
See `UPDATE_AD_TASK_BATCH_COOLDOWN_AR.md`. The older six-hour-per-view task rule has been replaced by a per-task batch limit and cooldown.

## Configurable repeatable AdsGram task batches

Run `easygram_ads_batch_cooldown_migration.sql` once in the Easy GRAM Supabase SQL Editor before deploying this version. It adds per-task `cooldown_hours` and per-user batch state while preserving balances and cumulative completion history. In Admin → Tasks, edit the AdsGram task and set **Ads per batch** (for example `6`) and **Cooldown after each ad batch** (for example `5` hours). A user receives one reward per verified ad; after the sixth reward the task is locked for five hours, then the next batch starts automatically. Set Ads per batch to `0` for unlimited ads without a batch cooldown.


## AdsGram Native Task (Easy Gram)

1. Run `easygram_adsgram_native_task_migration.sql` once in Supabase SQL Editor.
2. Set the server environment variable `ADSGRAM_REWARD_SECRET` to the same private secret configured in the AdsGram Reward URL. Never place this secret in frontend code.
3. In the AdsGram publisher dashboard, create one Task block and configure its Reward URL as:
   `https://YOUR-EASYGRAM-DOMAIN/api/auth/me?adsgram_reward=1&secret=YOUR_SECRET&userid=[userId]&kind=native_task`
4. In Easy Gram Admin → Settings → AdsGram Native Task, enter the Task block ID in `task-0000` format and set its GRAM reward.
5. The popup appears after the user's third tap in an app session. The client event only triggers a claim attempt; the backend pays only after the AdsGram Reward URL verifies the user.

The AdsGram Task web component reads only the Task block ID. Configure the Mini App Web app URL / task destination in the AdsGram dashboard itself; it is not a supported `data-*` parameter of `<adsgram-task>`.


Arabic setup guide for AdsGram Native Task: `ADSGRAM_NATIVE_TASK_EASYGRAM_AR.md`.

## V7 — Arcade, daily check-in and gift codes

This update adds an Easy Gram-only gamification layer: Orbit Dash, Memory Matrix, Reactor Rush, seven-day daily check-in rewards, redeemable gift codes, recent game runs and a weekly arcade leaderboard. The admin panel can create/edit/pause/delete codes and configure game attempts, per-game rewards and each of the seven daily rewards.

For an existing database, back it up and run `easygram_arcade_rewards_migration.sql` once after the Coins/USDT migration has already created `easygram_users.coin_balance` and `easygram_users.is_banned`. Do not rerun the full `sql_easygram.sql` against a live installation. Fresh database order: `sql_easygram.sql`, `easygram_coins_usdt_migration.sql`, then `easygram_arcade_rewards_migration.sql`.

See `UPDATE_ARCADE_REWARDS_AR.md` for the full Arabic setup guide, game rules, reward settings and testing limitations. These games use Easy Gram's existing `coin_balance`; no SLY tables or balances are used. No new environment variables are required.
