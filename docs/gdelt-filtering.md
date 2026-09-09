# GDELT Data Quality — Noise Reduction

**Date**: 2026-03-29 (thresholds updated 2026-09-08 to match the code)
**Status**: Approaches 1 and 4 implemented, plus an explicit country-code filter and a TIGER state-join prune (June 2026)

## The Problem

GDELT uses NLP to auto-classify news articles into CAMEO event codes. In the US context, many codes produce false positives (e.g., Easter egg "hunt" coded as violence, suicide *prevention* articles coded as "Suicide Attack").

## What We Implemented

### Approach 1: Dropped Noisy CAMEO Codes

**Removed entire root code:**
- CAMEO 17 (Coerce/Threaten) — too many false positives from political rhetoric, weather threats, legal language

**Removed specific event codes:**
- 190 (Use Unconventional Force) — vague, catches non-violence
- 192 (Bombing) — 99%+ false positives in US context. NLP misreads "bombshell", "bomb cyclone", "bombing run" (football), etc. Verified: 113 events in 72h, virtually all were water restrictions, horse racing, bakery openings, etc. Real US bombings are <2/year.
- 193 (Suicide Attack) — almost entirely false positives in US (suicide prevention articles)
- 194 (Use WMD) — always false positives in US
- 195 (Biological Attack) — always false positives in US
- 182 (Seize/Control) — often business acquisitions, not violence

**Kept (reliable):**
- 140-145: Protest, Demonstrate, Strike, Violent Protest (root 14)
- 180-181, 183-186: Conventional Force, Assault, Abduct, Destroy Property, Armed Attack (root 18)
- 191: Gunfire (root 19)
- 200-203: Mass Violence, Mass Killing, Ethnic Cleansing (root 20)

### Approach 4: Confidence Scoring via NumArticles

Added a `NumArticles >= 3` filter (started at 2, raised to 3). GDELT column 33 indicates how many news articles reference the same event. Single-source events are more likely misclassifications. Requiring 3+ articles provides multi-source confirmation.

**Combined impact**: ~1,500 events reduced to ~400-500, with significantly higher accuracy.

## Future Options

### Approach 3: ACLED (human-verified data)
- Free API with registration at acleddata.com
- Human-coded, zero false positives
- Weekly updates with 1-2 week lag
- Would serve as a "verified" layer alongside GDELT's real-time data

### Approach 2: URL/Domain Filtering
- Filter by source article domain (drop entertainment, sports sites)
- More complex, requires fetching article metadata

### Approach 5: Hybrid with ACLED
- Use GDELT for real-time (last 72h) with current filtering
- Supplement with ACLED weekly for verified historical events
- Let users toggle between "real-time" and "verified" views
