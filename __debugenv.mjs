import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "./src/convex/_generated/api.js";

// Read the exact URL the browser client uses (same as src/lib/copilot.ts).
const raw = readFileSync(".env.local", "utf8");
const get = (k) => {
  const m = raw.match(new RegExp("^" + k + "=(.*)$", "m"));
  return m ? m[1].trim() : null;
};
const url = get("VITE_CONVEX_URL");

console.log("TARGET_URL:", url);
const client = new ConvexHttpClient(url);

try {
  const result = await client.action(api.debugEnv.debugEnv);
  console.log("RESULT_JSON:", JSON.stringify(result, null, 2));
} catch (err) {
  console.log("CALL_FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
}
