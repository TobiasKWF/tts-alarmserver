const express = require("express");

const requestId = require("./middleware/request-id");

const logger = require("./middleware/logger");

const health = require("./routes/health");

const app = express();

app.use(express.json());

app.use(requestId);

app.use(logger.middleware);

app.use("/health", health);

module.exports = app;
