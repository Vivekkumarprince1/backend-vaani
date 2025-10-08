function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function retry(fn, opts = {}) {
  const {
    retries = 3,
    factor = 2,
    minDelay = 200,
    maxDelay = 2000,
    onRetry = null
  } = opts;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const isRetryable = err && (err.isRetryable || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT');

      // If the server sent Retry-After, respect it
      const retryAfter = err && err.retryAfterMs;
      if (!isRetryable && !retryAfter) throw err;

      if (attempt > retries) throw err;

      const backoff = retryAfter != null ? Math.min(retryAfter, maxDelay) : Math.min(minDelay * Math.pow(factor, attempt - 1), maxDelay);
      if (onRetry) {
        try { onRetry(attempt, backoff, err); } catch (_) {}
      }
      await sleep(backoff);
    }
  }
}

module.exports = { retry, sleep };
