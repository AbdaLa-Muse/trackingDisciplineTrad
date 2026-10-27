# TradeFlow v11 — Growth Cycle Risk System

1. Run `SUPABASE-V11-GROWTH-CYCLE-UPDATE.sql` in Supabase SQL Editor.
2. Upload the GitHub-ready files, keeping `index.html` at repository root.
3. In Settings → Accounts, set Account Size for existing accounts. New accounts require Account Size.
4. A newly configured/reset account starts at `Cycle 3 · Caution`.
5. Daily Review records Risk (1%/2%) and Trade Return % for each selected account.
6. 2% is discipline-safe only after 2% progress above that cycle's base and only once per cycle.
7. Reset Cycle preserves history and starts fresh from Cycle 3.

Legacy reviews without Trade Return % remain unchanged and are not retroactively reclassified by the new rules.
