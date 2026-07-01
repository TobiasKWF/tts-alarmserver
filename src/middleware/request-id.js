const { randomUUID } = require("crypto");

module.exports = (req, res, next) => {

    req.requestId = randomUUID();

    res.setHeader("X-Request-Id", req.requestId);

    next();

};
