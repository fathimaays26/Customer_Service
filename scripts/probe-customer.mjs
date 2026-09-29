import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const raw = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const env = Object.fromEntries(
  raw
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }),
);

const supabase = createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
);

const { count } = await supabase
  .from("dim_customer")
  .select("*", { count: "exact", head: true });
console.log("dim_customer row count:", count);

// First 1000 rows (what the current filter query returns by default)
const firstPage = await supabase
  .from("dim_customer")
  .select("customer_id, customer_type");
console.log("default select rows returned:", (firstPage.data ?? []).length);

const typesFirstPage = [
  ...new Set((firstPage.data ?? []).map((r) => r.customer_type)),
].sort();
console.log("customer_type in default first page:", typesFirstPage);

// Full distinct set
const pages = Math.ceil((count ?? 1000) / 1000);
const reqs = [];
for (let p = 0; p < pages; p++) {
  reqs.push(
    supabase
      .from("dim_customer")
      .select("customer_id, customer_type")
      .range(p * 1000, p * 1000 + 999),
  );
}
const results = await Promise.all(reqs);
const all = results.flatMap((r) => r.data ?? []);
console.log("full rows fetched:", all.length);
console.log(
  "ALL distinct customer_type:",
  [...new Set(all.map((r) => r.customer_type))].sort(),
);

// Also check other tables the filter panel reads (limit-1000 issue)
for (const t of ["fact_service_case"]) {
  const { count: c } = await supabase
    .from(t)
    .select("*", { count: "exact", head: true });
  const d = await supabase
    .from(t)
    .select("channel, priority, status, category");
  console.log(`${t}: total=${c} defaultSelectRows=${(d.data ?? []).length}`);
}
