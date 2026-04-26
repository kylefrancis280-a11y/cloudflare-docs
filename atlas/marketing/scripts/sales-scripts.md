# Atlas Analysis — Sales & Conversion Scripts

## 1. Live Chat / Support Chat Scripts

### Opener — Inbound visitor (no account)

**Trigger:** Visitor has been on the landing page for 45+ seconds

"Hey — happy to answer any questions about Atlas. What kind of investing do you do? I can tell you if the platform is a good fit for how you work."

---

### Qualifying questions (ask max 2)

**Q1:** "Which markets do you focus on — TSX, NYSE, or both?"
- TSX focus → "Our TSX coverage is deep, especially Mining and Energy. A lot of Canadian retail investors find that useful because most AI research tools are US-only."
- NYSE focus → "We cover NYSE/NASDAQ across AI, Tech, Biotech, Defense, Media. The macro alignment piece is where we tend to differentiate — most tools don't weight sectors differently based on the current rate and VIX regime."
- Both → "Good — we cover both. The Atlas Score runs the same framework regardless of exchange."

**Q2:** "What does your research routine look like right now? Are you reading analyst reports, using a screener, something else?"
- Analyst reports → "Atlas gives you the same analyst consensus data (buy/hold/sell split) baked into every score, plus an AI-written note that references those numbers specifically. It's designed to cut your reading time, not replace your judgment."
- Screener → "Different product. Atlas isn't a screener — it doesn't filter by static metrics. It's a daily research tool. The Atlas Score is a point-in-time assessment, not a filter."
- Nothing structured → "Probably the best fit then. You'd have a structured morning routine before open without building one from scratch."

---

### Objection responses

**"I already use ChatGPT for this."**

"ChatGPT doesn't have live prices, real-time news, or analyst consensus data built in — you'd have to paste that yourself every time. Atlas runs the data pipeline automatically every night and grounds the AI output in real numbers. The model doesn't generate the factors — it interprets them."

**"It's too expensive for what I get."**

"CA$29.99 is roughly one trade commission. The value isn't in the content — it's in the time. If Atlas saves you 45 minutes of morning research every trading day, the math works out to less than $2 per session. Seven-day trial lets you test that before you pay anything."

**"How do I know the Atlas Score works?"**

"We don't promise the Score predicts price — nothing does reliably. What it does is surface which names have the most factors pointing the same direction, so you're spending your research time where the signal density is highest. Pro tier has a backtest track record view if you want to see historical patterns."

**"I mainly invest in TSX names in the mining sector."**

"That's one of our strongest areas. Mining gets sector-specific macro weighting — when the yield curve inverts or gold prices move, that's reflected in the alignment factor. Most AI research tools are built on US-centric data. We have TSX-deep coverage for exactly this."

---

### Closing

"Best thing I can suggest is the seven-day trial — you'll know in the first morning whether the daily analysis rhythm works for you. No credit card commitment to start."

[Link to trial signup]

---

## 2. Trial-to-Paid Conversion Call Script

**Context:** User has completed 5+ days of trial, hasn't subscribed yet. Outbound check-in call or chat.

---

**Opener:**

"Hey [name] — just checking in. You've been using Atlas for [X] days. How's the morning research flow working?"

*Wait for response. Listen for:*
- "It's useful but..." → probe the "but"
- "I haven't had time to use it much" → ask what would make it part of their routine
- "It's been helpful" → transition to conversion

---

**If positive signal:**

"Glad it's been useful. Your trial ends [date]. Based on how you've been using it — [sector they've been looking at], [features they've used] — I'd recommend Core at CA$29.99 to start. Does that work, or do you want to talk through Pro?"

---

**Pro upsell (if they've hit any Pro feature):**

"I see you accessed the [sector leaderboard / price stream / export] — those are Pro features. Pro is CA$49.99, which gets you real-time prices instead of the 15-minute delay, plus those features unlocked permanently. Given that you're [active trader / following fast-moving sectors], that might be worth the extra $20."

---

**If trial was low-engagement:**

"I see you only had a chance to log in [X] times. That sometimes happens in a busy week. Want me to extend your trial by 5 days so you can get a full week of pre-market reports?"

*If yes → extend. If no → ask what would need to be different.*

---

**Close:**

"If you want to continue after your trial, everything stays as-is — your dashboard, your searches, your history. Just keep the card on file and you'll roll over automatically. If you want to cancel, you can do it in settings anytime."

---

## 3. Institutional Sales Script

**Context:** Outbound to small fund managers, RIAs, family offices. Email-first, then call.

---

**Email subject:** Atlas Institutional — API access + custom universe for [firm name]

**Email body:**

[First name],

Atlas Analysis is an AI-powered equity research platform. Most of our users are self-directed retail investors — but we have an Institutional tier that's built differently.

Specifically:
- REST API access for bulk ticker analysis on demand
- Custom universe seeding — you define the coverage list
- Daily analysis SLA (delivered before 9:30am ET or you get credit)
- Dedicated support channel

The engine is Claude Sonnet 4.6 running against live prices (Polygon), analyst consensus, macro data, and recent SEC filings. The Atlas Score combines five quantifiable factors — I can send the full methodology document if that's useful.

Institutional is CA$99.99/mo. We can scope a pilot for your team.

15 minutes to walk through it?

[name]
Atlas Analysis

---

**Call opener:**

"Thanks for taking the call. I'll keep it short. Atlas runs a nightly analysis pipeline — scoring and narrative for stocks across eight sectors — and delivers it before market open. The Institutional tier gives you API access so you can pull scores and narratives into your own workflow. What I wanted to understand is how you currently consume equity research and whether there's a gap Atlas could fill."

---

**Qualification questions:**

1. "How many names are you actively monitoring — tens, hundreds, or more?"
2. "Do you have analysts doing morning research, or is it just you / a small team?"
3. "What data providers are you already subscribed to? I want to make sure we're not duplicating something you already have."

---

**Key objection — "We have Bloomberg."**

"Bloomberg is a data terminal. Atlas is an interpretation layer. We're not replacing Bloomberg data — we're built on Polygon for prices and our own news/macro pipeline. The value-add is the scoring and the AI-written narrative, which Bloomberg doesn't generate. A lot of small shops find that the synthesis layer is what they're missing, not the data itself."

---

**Close:**

"Would it be useful to run a pilot on 20–30 names from your universe? I can set up a custom seed list and you'd have seven days of daily analysis before we talk pricing. That gives you a real read on whether the Atlas Score adds anything to your process."

---

## 4. Referral / Word-of-Mouth Scripts

### What to say when asked "what is this thing you use for research?"

**Short version (30 seconds):**
"It's called Atlas Analysis. AI-powered stock research — daily reports across eight sectors before market open. It has this scoring system that factors in macro alignment, which is the part I actually find useful. It's not a trade signal, just a structured way to prioritize what to read. CA$30 a month."

**Long version (90 seconds):**
"It's called Atlas Analysis. Every morning before the market opens it runs an analysis pipeline across eight sectors — Mining, AI, Tech, Biotech, Energy, Defense, Media — and gives you a score for every name in its universe. The score is built from five real factors: price momentum, analyst consensus, news sentiment, macro alignment by sector, and a valuation signal.

The macro alignment piece is what makes it different. When the yield curve inverts, mining and defense are weighted differently than tech. Most platforms don't account for that at all.

Then it uses Claude — the Anthropic AI — to write a research note for the top movers in each sector. Specific bull and bear factors with actual numbers. One actionable insight.

Seven-day trial, CA$30 a month. atlasanalysis.net."

---
