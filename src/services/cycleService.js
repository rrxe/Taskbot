const { rpc } = require('../db');

// Returns the currently open monthly cycle, creating one if none exists yet.
async function getOrCreateOpenCycle() {
  return rpc('get_or_create_open_cycle');
}

// Closes the current cycle after admin confirms payments were made, and
// opens the next monthly cycle. Historical data is never deleted.
// Runs as a single database transaction (see end_month() in sql/schema.sql).
async function endMonth(adminId) {
  return rpc('end_month', { p_admin_id: adminId });
}

module.exports = { getOrCreateOpenCycle, endMonth };
