const rateLimit = require('express-rate-limit');

const proposalLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      'Прекалено много заявки от този IP адрес. Опитайте отново след около час.'
  }
});

module.exports = {
  proposalLimiter
};
