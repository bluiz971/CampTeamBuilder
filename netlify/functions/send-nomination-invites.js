/**
 * Netlify scheduled function — email nomination invitation graphics
 * 3 hours after submit. Scheduled functions cannot be invoked by URL.
 *
 * HTTP catch-up / admin send: process-nomination-invites
 */
const { run } = require('../lib/nomination-invites');

exports.handler = async () => {
  const result = await run({});
  return {
    statusCode: result.statusCode,
    body: JSON.stringify(result.body)
  };
};
