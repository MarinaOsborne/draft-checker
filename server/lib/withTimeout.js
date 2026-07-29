// Races `promise` against a plain timer, rejecting with a clear, branded
// error if the timer fires first — regardless of *why* `promise` is slow
// (a single hung call, or several fast-but-additive sequential calls that
// together still overrun the deadline). The timer's reject() always runs
// before `onTimeout` (e.g. an AbortController.abort() to actually cancel
// in-flight work) — see server/lib/googleClient.js for why that order
// matters: aborting first can make a fetch's own AbortError win the race
// and mask this function's clear message.
export function withTimeout(promise, ms, message, { onTimeout } = {}) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "timeout";
      reject(err);
      onTimeout?.();
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
