const https = require("https");

console.log("NODE_VERSION", process.version);
console.log("FETCH_TYPE", typeof fetch);
console.log("FETCH_SRC", (fetch + "").slice(0, 160));
console.log("HTTPS_REQ_SRC", (https.request + "").slice(0, 160));
console.log("WS_GLOBAL", typeof globalThis.WebSocket);

function getRoot() {
  return new Promise((resolve) => {
    const req = https.get("https://intent-badger-172.convex.cloud/", { timeout: 8000 }, (res) => {
      res.resume();
      res.on("end", () => resolve("OK " + res.statusCode));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve("TIMEOUT");
    });
    req.on("error", (e) => resolve("ERR " + e.message));
  });
}

(async () => {
  for (let i = 1; i <= 8; i++) {
    const r = await getRoot();
    console.log("TRY", i, "->", r);
    if (r.startsWith("OK")) break;
    await new Promise((s) => setTimeout(s, 10000));
  }
})();
