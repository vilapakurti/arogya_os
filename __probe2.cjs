const https = require("https");

const ADDR = "https://intent-badger-172.convex.cloud";

function httpsReq(method, path, body) {
  return new Promise((resolve) => {
    const req = https.request(
      ADDR + path,
      {
        method,
        headers: body
          ? {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
              "Convex-Client": "npm-http-client",
            }
          : { "Convex-Client": "npm-http-client" },
        timeout: 15000,
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve({ kind: "https", ok: true, status: res.statusCode, body: d.slice(0, 200) }));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ kind: "https", ok: false, err: "TIMEOUT" });
    });
    req.on("error", (e) => resolve({ kind: "https", ok: false, err: e.message }));
    if (body) req.write(body);
    req.end();
  });
}

async function fetchReq(method, path, body) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(ADDR + path, {
      method,
      headers: { "Content-Type": "application/json", "Convex-Client": "npm-http-client" },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const text = await res.text();
    return { kind: "fetch", ok: true, status: res.status, body: text.slice(0, 200) };
  } catch (e) {
    return { kind: "fetch", ok: false, err: String(e && e.message ? e.message : e).slice(0, 120) };
  }
}

(async () => {
  const actionBody = JSON.stringify({
    path: "diag:envCheck",
    format: "convex_encoded_json",
    args: [{}],
  });

  console.log("T1 https GET  /            ->", JSON.stringify(await httpsReq("GET", "/")));
  console.log("T2 https POST / (empty)    ->", JSON.stringify(await httpsReq("POST", "/")));
  console.log("T3 https POST /api/action  ->", JSON.stringify(await httpsReq("POST", "/api/action", actionBody)));
  console.log("T4 fetch  POST /api/action ->", JSON.stringify(await fetchReq("POST", "/api/action", actionBody)));
  console.log("T5 https GET  /api/action  ->", JSON.stringify(await httpsReq("GET", "/api/action")));
})();
