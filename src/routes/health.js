const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {

    res.json({

        ok: true,

        version: "3.0.0",

        requestId: req.requestId,

        uptime: process.uptime()

    });

});

module.exports = router;
