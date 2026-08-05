const https = require("https");

const address = "https://intent-badger-172.convex.cloud";
const body = JSON.stringify({
  path: "diag:envCheck",
  format: "convex_encoded_json",
  args: [{}],
});

const req = https.request(
  address + "/api/action",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Convex-Client": "npm-http-client",
    },
    timeout: 30000,
  },
  (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      console.log("STATUS", res.statusCode, res.statusMessage);
      try {
        const j = JSON.parse(data);
        if (j && typeof j === "object" && "value" in j) {
          console.log("RESULT", JSON.stringify(j.value, null, 2));
        } else {
          console.log("RESULT", JSON.stringify(j, null, 2));
        }
      } catch {
        console.log("RAW", data.slice(0, 2000));
      }
    });
  }
);
req.on("timeout", () => {
  console.log("TIMEOUT");
  req.destroy();
});
req.on("error", (e) => {
  console.log("ERR", e.message);
});
req.end(body);
