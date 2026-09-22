const { Telegraf, Markup } = require('telegraf');

function createBot() {
  const bot = new Telegraf(process.env.BOT_TOKEN);
  const webAppUrl = process.env.WEBAPP_URL;

  bot.start((ctx) => {
    const name = ctx.from?.first_name || 'صديقنا';
    ctx.reply(
      [
        `أهلاً ${name} 👋 معك Rocket.`,
        '',
        'حوّل وقت تصفحك اليومي لأرباح حقيقية عن طريق مشاهدة إعلانات AdsGram الرسمية:',
        '💰 رصيد يتحدّث فور كل مشاهدة مؤهّلة',
        '🌍 قيمة إعلانات مخصّصة لدولتك',
        '🏆 لوحة متصدرين شهرية',
        '💸 سحب حقيقي لرصيدك عند فتحه من الإدارة',
        '',
        'اضغط الزر تحت لفتح التطبيق وتبدأ 👇',
      ].join('\n'),
      Markup.inlineKeyboard([Markup.button.webApp('🚀 فتح Rocket', webAppUrl)])
    );
  });

  bot.help((ctx) => {
    ctx.reply(
      'دليل Rocket السريع:\n/start — فتح التطبيق\nالرصيد وسجل الأرباح داخل التطبيق نفسه، من تبويب "الرئيسية" و"السجل".\nلأي استفسار أو مشكلة بحسابك، تواصل مع الدعم.'
    );
  });

  // Realism/UX touch: the bot never goes silent on a random message —
  // it always nudges the user back to /start instead of ignoring them.
  bot.on('text', (ctx) => {
    if (ctx.message.text.startsWith('/')) return;
    ctx.reply('اكتب /start لفتح تطبيق Rocket ومتابعة أرباحك 👋');
  });

  bot.catch((err) => {
    console.error('Telegraf error:', err);
  });

  return bot;
}

module.exports = { createBot };
