// Express 4 does not catch rejected promises from async handlers — this does.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { wrap };
