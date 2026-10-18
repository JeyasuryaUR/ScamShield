# Demo script (about 4 minutes)

**Before going on stage:** scorer running, web app open in two tabs (`/queue` signed in as an
analyst, `/pay` on a second screen), replayer ready in a terminal, and a screen recording of
the same run as a backup.

## 1. The problem (20 s)
"Scams win in seconds. A fake KYC call gets someone to send ₹48,500 at 11:42 pm. The bank has
milliseconds to decide, and today's flags don't say why."

## 2. Live stream (40 s)
Run `python tools/replayer/replay.py --tps 25`.
- Point at the **p99 latency** tile on `/queue`: about 3 ms of scoring time, live from the scorer.
- Cards appear as payments get paused. "About 1 in 100 genuine payments gets a quick check;
  1 in 1,000 waits for a human."

## 3. Customer view (60 s), on `/pay`
1. **Groceries ₹640** and **₹3,000 to Amma**: both go straight through.
2. **₹15,000 advance to a marketplace seller**: *Hold on a moment*, in English and Tamil. Reasons:
   amount far above usual, new payee. Tap **Verify it is you**.
3. **"KYC Verification Desk" ₹48,500 at 11:42 pm**: **Payment on hold**, risk 0.98. Point at the
   right-hand panel: the reasons, scored in about 2 ms.

## 4. Analyst view (60 s), on `/queue`
- The ₹48,500 hold is at the top. Open it: *why it was flagged*, the model inputs, and this
  account's earlier payments (never paid this payee).
- Add a note ("customer confirmed scam call") and press **Keep hold**.
- Open **Audit log**: the decision and the review are both there with their inputs. Press
  **Verify hash chain**: "Intact. If anyone edits a row, even a database admin, this breaks."

## 5. Right for the right reasons (40 s), on `/model`
- "We planted 12 shortcuts, like an emulator flag and an ID format, into a copy of the data. The audit found
  11, with no false alarms. A model using them scores 98% recall. Remove what the audit flags and
  it falls to 75%, close to the 69% of a model on approved signals only. That gap was the shortcut."

## 6. Close (20 s)
"Scored where transactions live, on LinuxONE. Explained, human-in-the-loop, audited."
