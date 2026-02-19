const rateLimit = require('express-rate-limit');

const publicGenerateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP. Please try again in about an hour.'
  }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  publicGenerateLimiter,
  loginLimiter
};
