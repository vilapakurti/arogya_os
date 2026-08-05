const https = require("https");
const fs = require("fs");

const ADDR = "https://intent-badger-172.convex.cloud";
const body = JSON.stringify({
  path: "diag:envCheck",
  format: "convex_encoded_json",
  args: [{}],
});

function callAction() {
  return new Promise((resolve) => {
    const req = https.request(
      ADDR + "/api/action",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "Convex-Client": "npm-http-client",
        },
        timeout: 20000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () =>
          resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, body: d })
        );
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, err: "TIMEOUT" });
    });
    req.on("error", (e) => resolve({ ok: false, err: e.message }));
    req.write(body);
    req.end();
  });
}

(async () => {
  for (let i = 1; i <= 10; i++) {
    const r = await callAction();
    console.log("ATTEMPT", i, "->", r.ok ? "HTTP " + r.status : "ERR " + r.err);
    if (r.ok) {
      fs.writeFileSync("/tmp/diag_result.json", r.body);
      console.log("---BODY---");
      try {
        const j = JSON.parse(r.body);
        if (j && typeof j === "object" && "value" in j) {
          console.log("RESULT", JSON.stringify(j.value, null, 2));
        } else {
          console.log("RESULT", JSON.stringify(j, null, 2));
        }
      } catch {
        console.log("RAW", r.body.slice(0, 2000));
      }
      process.exit(0);
    }
    await new Promise((s) => setTimeout(s, 15000));
  }
  console.log("ALL_ATTEMPTS_FAILED");
  process.exit(1);
})();
