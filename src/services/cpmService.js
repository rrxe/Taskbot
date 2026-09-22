const { supabase, must, rpc } = require('../db');

async function getSetting(key, fallback) {
  const row = must(await supabase.from('settings').select('value').eq('key', key).maybeSingle());
  return row ? row.value : fallback;
}

// Admin sets/updates CPM for country+date. The database function recalculates
// every user_daily_stats row for that (country, date) and applies the delta
// to each user's available balance, all in one transaction.
async function setDailyCpm(countryId, cpmDate, cpm, adminId) {
  return rpc('set_daily_cpm', {
    p_country_id: countryId,
    p_date: cpmDate,
    p_cpm: cpm,
    p_admin_id: adminId,
  });
}

// Called after a single ad impression is validated as counted.
// Increments today's impression count for the user/country, and — if
// today's CPM is already known — immediately calculates the extra earnings.
async function recordCountedImpression({ userId, countryId, cycleId, date }) {
  return rpc('record_counted_impression', {
    p_user_id: userId,
    p_country_id: countryId,
    p_cycle_id: cycleId,
    p_date: date,
  });
}

module.exports = { getSetting, setDailyCpm, recordCountedImpression };
