function isDbUnreachable(err) {
  const msg = err?.message || err?.details || String(err);
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|network|getaddrinfo/i.test(msg);
}

function logDbError(context, err) {
  console.error(`[${context}]`, err?.message || err);
}

module.exports = { isDbUnreachable, logDbError };
