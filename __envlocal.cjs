const fs = require("fs");

const raw = fs.readFileSync(".env.local", "utf8");
const entries = [];
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m) entries.push(m);
}

console.log("TOTAL_ENTRIES", entries.length);
for (const [, name, value] of entries) {
  const flag =
    name.includes("KEY") || name.includes("SECRET") || name.includes("TOKEN")
      ? ` (len ${value.length})`
      : "";
  console.log("  " + name + flag);
}
console.log("HAS_GEMINI_API_KEY:", /^GEMINI_API_KEY=/.test(raw));
console.log("HAS_GEMINI_MODEL:", /^GEMINI_MODEL=/.test(raw));
console.log("HAS_SUPABASE_URL_UNPREFIXED:", /^SUPABASE_URL=/.test(raw));
console.log("HAS_VITE_SUPABASE_URL:", /^VITE_SUPABASE_URL=/.test(raw));
