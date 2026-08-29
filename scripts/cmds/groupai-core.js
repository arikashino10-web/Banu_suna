/**
 * Compatibility shim: GroupAI now lives in groupai.js.
 * Keep this export for older code that imports the former core module.
 */
module.exports = require("./groupai").core;
