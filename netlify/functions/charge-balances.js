/**
 * Backward-compatible alias — schedule prefers charge-remaining-balance.
 * Same one-attempt deposit_paid → balance_charged | charge_failed logic.
 */
module.exports = require('./charge-remaining-balance');
