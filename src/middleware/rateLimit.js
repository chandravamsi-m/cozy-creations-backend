const buckets = new Map();

function createRateLimiter({ windowMs, max, prefix = "default" }) {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive number");
  }
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("max must be a positive number");
  }

  return function rateLimit(req, res, next) {
    const key = `${prefix}:${req.ip || "unknown"}`;
    const now = Date.now();
    const entry = buckets.get(key);

    if (!entry || entry.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (entry.count >= max) {
      return res.status(429).json({
        error: "Too many requests",
        code: "RATE_LIMITED",
      });
    }

    entry.count += 1;
    next();
  };
}

module.exports = { createRateLimiter };
