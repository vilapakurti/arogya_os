globalThis.WebSocket = require("ws");
process.argv = [
  "node",
  "convex",
  "run",
  "diag:envCheck",
  "{}",
  "--typecheck",
  "disable",
  "--codegen",
  "disable",
];
require("./node_modules/convex/bin/main.js");
