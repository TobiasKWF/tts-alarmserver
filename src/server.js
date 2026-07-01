const app = require("./app");
const config = require("./config");
const logger = require("./middleware/logger");

app.listen(config.port, () => {

    logger.info("tts-alarmserver gestartet", {

        version: "3.0.0",

        port: config.port

    });

});
