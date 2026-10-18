# Scam Shield

Real-time decisions that stop payment scams before the money leaves.
Team Inat · IBM Z Datathon 2026 · Real-Time AI for Critical Decisions

Every payment is scored in about a millisecond, explained with reason codes, and routed to
**allow**, **verify** (customer gets a step-up check and a warning in English and Tamil) or
**hold** (an analyst releases or blocks it). Every decision lands in a tamper-evident audit
log, and a shortcut audit checks the model is right for the right reasons.

```
 Replayer / app ──POST /score──▶ Scorer (FastAPI + LightGBM)   ◀── runs on IBM LinuxONE
                 ◀── decision ──  features → risk → reasons → action      (~1–3 ms p99)
                                        │ async, batched (never blocks a payment)
                                        ▼
                                  Supabase  (Postgres + RLS · Auth · Realtime · Storage)
                                        │ realtime
                                        ▼
                                  Next.js app: review queue · decision detail ·
                                  audit log · model report · customer demo (/pay)
```

More detail: [docs/architecture.md](docs/architecture.md) · numbers: [docs/results.md](docs/results.md) ·
stage demo: [docs/demo-script.md](docs/demo-script.md) · original plan: [docs/PLAN.md](docs/PLAN.md)

## Repo map

| Path | What lives there |
|---|---|
| `services/scorer/` | FastAPI scoring service. `features.py` is shared with training, so there's no train/serve skew |
| `ml/src/` | Data prep, training, evaluation, planted shortcuts, shortcut audit, publishing |
| `ml/artifacts/` | The trained model, thresholds (`policy.yaml`), metrics, audit results, account-history snapshot |
| `apps/web/` | Next.js 16 app (App Router, Cache Components, Tailwind v4, Supabase SSR auth) |
| `supabase/` | Migrations (schema, RLS, audit hash chain, write functions) + PGlite tests |
| `tools/` | Stream replayer, load tester, staff-account script |

## Run it locally

You need Python 3.11+, Node 20.9+, and Docker Desktop (for local Supabase).

```bash
# 1. Python env (scorer + ML + tools)
python -m venv .venv
.venv\Scripts\activate            # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# 2. Data + model. Uses ml/data/raw/PS_*.csv (Kaggle "ealaxi/paysim1") if present,
#    otherwise generates PaySim-format synthetic data with realistic scam behaviour.
python ml/src/pipeline.py         # ~4 min: prep → train → evaluate → shortcut audit

# 3. Supabase (applies supabase/migrations automatically)
npx supabase start
npx supabase status               # copy API URL, anon key, service_role key
cp .env.example .env              # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
cp apps/web/.env.example apps/web/.env.local   # fill the same + anon key

# 4. A staff login, and the model report for the /model page
python tools/admin/create_user.py --email you@inat.dev --password 'choose-one' --name "Your Name" --role analyst
python ml/src/publish.py

# 5. Scorer (terminal 1)
cd services/scorer && uvicorn scorer.main:app --env-file ../../.env --port 8000

# 6. Web app (terminal 2)
cd apps/web && npm install && npm run dev        # http://localhost:3000

# 7. Stream payments into the scorer (terminal 3)
python tools/replayer/replay.py --tps 25
```

Open http://localhost:3000, sign in, and watch held payments arrive in the queue. The customer
demo is at http://localhost:3000/pay (no login).

## Tests and checks

| Command | Checks |
|---|---|
| `cd services/scorer && pytest` | features use only the past, reasons are literally true, policy, API, idempotency |
| `cd supabase/tests && npm i && npm test` | migrations, RLS per role, review rules, append-only audit log, tamper detection |
| `cd apps/web && npx eslint . && npx tsc --noEmit && npx next build` | web lint, types, production build |
| `ruff check . && ruff format --check .` | Python lint and format |
| `python tools/loadtest/loadtest.py --rate 200` | p50/p95/p99 latency at a fixed load, plus in-service scoring time |

CI (`.github/workflows/ci.yml`) runs all of the above, plus a small end-to-end ML run and a
multi-arch scorer image build for `linux/amd64` and `linux/s390x` (LinuxONE).

## Deploy

1. **Supabase Cloud**: create a project, then `npx supabase link --project-ref <ref>` and
   `npx supabase db push`. In Auth settings, turn off public sign-ups (staff are created with
   `tools/admin/create_user.py`).
2. **Scorer on LinuxONE** (Community Cloud VM, s390x): install Docker or Podman, clone the repo, then
   ```bash
   docker build -f services/scorer/Dockerfile -t scamshield-scorer .
   docker run -d -p 8000:8000 --env-file .env --name scorer scamshield-scorer
   ```
   Set `SCORER_API_KEY` and put TLS in front (e.g. Caddy) before exposing it. LightGBM is built
   from source for s390x inside the image. Check this early: `docker build` is the first thing to try on the VM.
3. **Web on Vercel**: import the repo with root directory `apps/web` and add the variables from
   `apps/web/.env.example`. Point `SCORER_URL` at the LinuxONE scorer.
4. Run `python tools/loadtest/loadtest.py --url https://<scorer> --label linuxone --rate 200` and
   record the numbers in `docs/results.md`.

## Data

- **PaySim** (Kaggle `ealaxi/paysim1`): drop `PS_*.csv` into `ml/data/raw/`. Full PaySim needs about 8 GB RAM
  for feature building; use `--max-rows 2000000` on smaller machines. Note that in PaySim almost every
  sender appears only once, so per-customer signals (new payee, unusual amount) are weak there.
  That's why the synthetic generator exists.
- **IEEE-CIS** (Kaggle `ieee-fraud-detection`): put `train_transaction.csv` and `train_identity.csv` in
  `ml/data/raw/ieee/`, then `python ml/src/pipeline.py --ieee` for a real-data proxy audit on device
  and identity fields.
- **Synthetic** (`ml/src/make_synthetic.py`): PaySim columns, but customers have histories, regular
  payees and daily rhythms, plus injected authorised-push-payment scams and mule cash-outs.

No real customer data is used anywhere.
