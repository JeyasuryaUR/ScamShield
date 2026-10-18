import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import fs from "node:fs";

// Applies every migration in order against PGlite (Postgres in WASM), no Docker needed.
const dir = new URL("../migrations/", import.meta.url);
const migration = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => fs.readFileSync(new URL(f, dir), "utf8")).join("\n");
const db = new PGlite({ extensions: { pgcrypto } });

// Minimal stand-in for what Supabase provides.
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema extensions; grant usage on schema extensions to anon, authenticated, service_role;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`);
await db.exec(migration);
console.log("migration applied");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failures++;
};
const expectError = async (name, fn, pattern) => {
  try {
    await fn();
    check(name, false, "(no error)");
  } catch (e) {
    check(name, pattern.test(e.message), `(${e.message})`);
  }
};
const as = async (role, sub) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${sub ?? ""}', false); set role ${role};`);
};

const ANALYST = "00000000-0000-0000-0000-00000000000a";
const COMPLIANCE = "00000000-0000-0000-0000-00000000000c";
await db.exec(`
  insert into auth.users (id, email) values ('${ANALYST}', 'ana@bank.test'), ('${COMPLIANCE}', 'comp@bank.test');
  update public.profiles set role = 'compliance' where id = '${COMPLIANCE}';
`);
check("profiles created by trigger", (await db.query("select count(*)::int n from profiles")).rows[0].n === 2);

const item = (id, action, risk) => ({
  txn: { txn_id: id, account_id: "C1", payee_id: "C9", amount: 48500, type: "TRANSFER",
         ts: "2026-10-20T18:12:00+00:00", old_balance: 52000, channel: "stream" },
  decision: { txn_id: id, risk, action, reasons: [{ code: "NEW_PAYEE", weight: 0.4 }],
              model_version: "lgbm-test", latency_ms: 2.1 },
  features: { is_new_payee: 1, amount_vs_sender_mean: null },
});
const batch = JSON.stringify([item("T1", "allow", 0.01), item("T2", "verify", 0.4), item("T3", "hold", 0.95)]);

await as("anon");
await expectError("anon cannot ingest", () => db.query("select ingest_decisions($1::jsonb)", [batch]), /permission denied/);
await as("authenticated", ANALYST);
await expectError("analyst cannot ingest", () => db.query("select ingest_decisions($1::jsonb)", [batch]), /permission denied/);

await as("service_role");
check("service ingests 3", (await db.query("select ingest_decisions($1::jsonb) n", [batch])).rows[0].n === 3);
check("re-ingest is idempotent", (await db.query("select ingest_decisions($1::jsonb) n", [batch])).rows[0].n === 0);
const statuses = (await db.query("select txn_id, status from decisions order by txn_id")).rows.map((r) => r.status);
check("statuses from actions", statuses.join() === "allowed,awaiting_customer,pending_review", statuses.join());

const holdId = (await db.query("select id from decisions where txn_id = 'T3'")).rows[0].id;

await as("authenticated", ANALYST);
check("analyst reads decisions (RLS)", (await db.query("select count(*)::int n from decisions")).rows[0].n === 3);
const upd = await db.query("update decisions set status = 'released' where id = $1", [holdId]);
check("analyst cannot update directly", upd.affectedRows === 0);
const r1 = await db.query("select review_decision($1, 'release', 'called the customer') s", [holdId]);
check("analyst releases hold", r1.rows[0].s === "released");
await expectError("double review rejected", () => db.query("select review_decision($1, 'keep_hold')", [holdId]), /not pending review/);

await as("authenticated", COMPLIANCE);
check("compliance reads audit log", (await db.query("select count(*)::int n from audit_log")).rows[0].n === 4);
await expectError("compliance cannot review", () => db.query("select review_decision($1, 'release')", [holdId]), /only analysts/);

await as("authenticated", "00000000-0000-0000-0000-0000000000ff");
check("non-staff sees nothing", (await db.query("select count(*)::int n from decisions")).rows[0].n === 0);

await as("service_role");
check("customer verifies", (await db.query("select customer_respond('T2', 'verified') s")).rows[0].s === "customer_verified");
await expectError("customer cannot re-verify", () => db.query("select customer_respond('T2', 'cancelled')"), /cannot/);

await db.exec("reset role");
const chain = (await db.query("select * from verify_audit_chain()")).rows[0];
check("audit chain intact", chain.ok === true && Number(chain.checked) === 5, JSON.stringify(chain));
await expectError("audit log rejects delete", () => db.query("delete from audit_log"), /append-only/);
await expectError("audit log rejects update", () => db.query("update audit_log set actor = 'x'"), /append-only/);

// Tamper with a row behind the trigger's back (a superuser could) -> the chain must notice.
await db.exec(`alter table audit_log disable trigger audit_log_no_update;
  update audit_log set payload = payload || '{"risk": 0.01}' where id = 3;
  alter table audit_log enable trigger audit_log_no_update;`);
const tampered = (await db.query("select * from verify_audit_chain()")).rows[0];
check("tampering detected", tampered.ok === false && Number(tampered.first_bad_id) === 3, JSON.stringify(tampered));

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
