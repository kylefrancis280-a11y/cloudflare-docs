# Atlas Analysis — Social Media Copy

## Brand Voice

**Tone:** Direct, data-literate, no hype. We write for people who know what a yield curve is.
**Never:** "🚀 to the moon", "diamond hands", vague superlatives, fake urgency.
**Always:** Specific numbers, honest framing, actual product utility.
**Hashtags:** Use sparingly. #stockresearch #equityresearch #TSX #investingtools when relevant.

---

## X (Twitter) — Post Templates

### Category: Product / Feature

---

**[Feature — Atlas Score]**
The Atlas Score isn't magic.

It's five factors:
- Momentum (30%) — price + range position
- Analyst breadth (20%) — buy/sell split
- News momentum (15%) — recency + sentiment
- Macro alignment (20%) — sector vs. regime
- Valuation (15%) — P/E percentile

Score + Claude-written narrative. Same data source. Same read, every time.

atlasanalysis.net

---

**[Feature — Macro alignment]**
Most retail platforms give you the stock.
Atlas gives you the stock and the macro context.

When the 10y–2y spread inverts, defense and mining score differently than tech and media.

That's not an opinion. That's a sector weight.

---

**[Feature — Daily timing]**
Analysis lands before 9:30am ET.

Not after the move. Before the open.

Every sector. Every morning.

atlasanalysis.net

---

**[Feature — Sectors]**
8 sectors. Top 6 movers by abs % in each get full narrative treatment.

Mining · AI · Tech · Biotech
Energy · Defense · Media · Other

Everything else gets scored. You see what moved, not everything.

---

### Category: Education / Value

---

**[Thread — How to read a research note]**
How to actually use an Atlas research note (quick thread):

1/ The insight line comes first. It's the synthesis. Start there.

2/ Bulls: 3 specific factors with numbers. "5 of 7 analysts upgraded last 30 days" — not "strong chart."

3/ Bears: 2 risks, same standard. If the bears are weak, that's signal too.

4/ Atlas Score: if the note is bullish and the Score is 38, something doesn't add up. Look at the macro alignment factor.

5/ Then check the price. Don't start with it.

---

**[Thread — Atlas Score vs. price]**
The Atlas Score and the stock price are not the same thing.

A high Score on a down day means: the factors are bullish, the market is selling anyway.

A low Score on an up day means: the move is thin, the fundamentals aren't behind it.

Both are useful. Neither is a trade signal by itself.

---

**[Thread — Macro regime]**
VIX above 22 changes which sectors are worth following.

In stress regimes:
- Defense: macro alignment score jumps
- AI: multiples compress, score drops
- Mining: depends on whether it's risk-off (gold rush) or credit crunch

Atlas weights all of this. Every sector. Every morning.

---

**[Thread — Yield curve]**
The 10y–2y spread inverted again.

What Atlas does with that:
- Mining sector gets a slight macro boost (flight to real assets)
- Tech gets dinged (rate uncertainty)
- Defense scores up (safe haven premium)

This isn't macro analysis you need to do yourself. It's built in.

---

### Category: Social Proof

---

"I used to spend 2 hours reading analyst reports every morning. Atlas cuts that to 10 minutes."

Real feedback. Unedited. From a Toronto-based active trader.

If your morning research routine isn't working, there's a better way.

atlasanalysis.net — 7-day trial.

---

Atlas scored this name Bullish (74) on Monday morning.

By Friday close: +8.4%.

Not claiming causation. Showing the work.

→ Full track record in-platform [Pro tier]

---

### Category: Pricing / Conversion

---

CA$29.99/mo for institutional-grade daily stock research.

That's one lunch.

7-day free trial. Cancel anytime.

atlasanalysis.net

---

Three tiers:

Core — CA$29.99/mo · Everything you need to start
Pro — CA$49.99/mo · Real-time prices, leaderboards, export
Institutional — CA$99.99/mo · API access, custom universe, SLA

What's the right tier? Reply and tell us how you invest. We'll tell you.

---

### Category: Engagement / Community

---

Which sector has been the most interesting to watch this week?

Mining · AI · Tech · Biotech · Energy · Defense · Media

Reply below. We'll share what Atlas was showing on the leaders.

---

What's your morning research routine?

- Read analyst reports
- Check Bloomberg/Reuters
- Scroll fintwit
- Some combination

We built Atlas for the people who said "there has to be a better way."

---

Quick question: what would make Atlas more useful for how you trade?

We read every reply. Several features in the current build came from this conversation.

---

## LinkedIn — Post Templates

### Professional / Platform announcement

---

**[Launch / product]**

We built Atlas Analysis to answer a question we kept asking ourselves: why does institutional-grade equity research cost $50,000/year?

The answer is: it doesn't have to.

Atlas covers 8 market sectors with AI-powered daily analysis — proprietary Atlas Score, analyst consensus, macro regime weighting, and a Claude-written research narrative — before market open every morning.

Starting at CA$29.99/mo.

7-day free trial at atlasanalysis.net.

We're a small team. We trade with our own platform. We built it because we needed it and couldn't find it.

---

**[Feature — AI pipeline]**

The Atlas analysis pipeline has two stages. Here's why that matters.

**Stage 1 — Deterministic factors (no AI)**
Five quantitative signals computed server-side: momentum, analyst breadth, news momentum, macro alignment, valuation. These are real numbers from real data. No hallucination risk.

**Stage 2 — Narrative (Claude Sonnet 4.6)**
Claude receives the Stage 1 factors plus raw data (price, news headlines, analyst recs, macro snapshot, recent SEC filings) and writes the research note. Same input. Same schema. Structured JSON output.

The Atlas Score and the narrative are derived from identical source data. If they ever disagree, something is wrong — that's a bug, not a feature.

This architecture is important: the AI doesn't invent the numbers, it interprets them.

Platform: atlasanalysis.net

---

**[Thought leadership — Retail research gap]**

The research gap in retail investing is real.

Professional analysts write for institutional clients. Retail investors get watered-down versions 48 hours later, behind a paywall, on a platform that also wants to sell them order flow.

What's missing:
- Macro context woven into stock-level analysis
- Analyst consensus data, not just price targets
- Daily cadence tied to market hours
- Honest bear factors alongside the bull case

Atlas was built to close that gap. Not to make you dependent on it — to make you better at doing your own research.

atlasanalysis.net

---

**[Hiring / team]**

We're a small team at Atlas Analysis. Two engineers, one analyst, one ops person.

We're not hiring right now — but if you're a quantitative analyst who trades their own book and thinks about retail market infrastructure, we'd like to know you.

DM or email: [team@atlasanalysis.net]

---

## Reddit — Post Templates (r/investing, r/stocks, r/canadianinvestors)

*Note: Reddit requires transparency. Always disclose you're affiliated with the product. These are written as founder/team posts.*

---

**[r/canadianinvestors — Soft intro]**

**Built an AI stock research tool focused on TSX + NYSE — here's what we learned**

We've spent the last year building Atlas Analysis, an AI-powered equity research platform. Happy to share what we learned, even if you never use our platform.

**What actually works in AI equity research:**
- Grounding the AI in real numbers first (price, analyst recs, macro) before asking for narrative
- Structured output (JSON schema) prevents hallucinations better than free-form prompts
- Macro alignment at the sector level is meaningfully predictive — tech in a high-rate environment is just different from tech in an easing cycle

**What doesn't work:**
- Asking LLMs to predict price direction (they're not better than random)
- Pure sentiment analysis without quantitative grounding
- Daily analysis that lands after market open (obvious, but a lot of products do this)

If you're curious about the platform: atlasanalysis.net — CA$29.99/mo, 7-day free trial. We're a small team, Canadian-founded.

Disclosure: I'm a co-founder. Happy to answer questions about the build, not just the product.

---

**[r/stocks — Technical breakdown]**

**How we calculate the Atlas Score — full breakdown (no black box)**

Transparency post for anyone interested in how AI-assisted scoring systems can work.

Our Atlas Score (22–97 range) is a weighted combination of five factors:

**1. Momentum (30%)** — We calculate position within the day's range (High–Low) and combine it with absolute % change. A stock up 3% but sitting at its day low scores worse than one up 3% near the day high.

**2. Analyst breadth (20%)** — Buy/Hold/Sell split across all covering analysts. 8 Buys, 0 Sells scores ~80. 4 Buys, 4 Sells scores ~50. We weight the tails.

**3. News momentum (15%)** — Headlines from the last 7 days, classified positive/neutral/negative. More recent headlines get weighted heavier.

**4. Macro alignment (20%)** — This is the interesting one. Each sector has an explicit macro mapping. When 10y–2y inverts: mining goes up, tech goes down. When VIX > 22: defense goes up, AI goes down. These are pre-defined rules, not learned weights.

**5. Valuation (15%)** — Simple P/E percentile. Sub-12x gets +28pts. 50x+ gets +28pts from the bottom. It's a guardrail, not a precision tool.

All five get combined, then Claude reads the same underlying data and writes the narrative.

Questions welcome. The platform is atlasanalysis.net if you want to see it in action.

Disclosure: built this, not just a user.

---

## Instagram / Short-form

*Note: Atlas is data-dense. Instagram works better for brand awareness than conversion. Keep visuals in mind.*

---

**[Carousel concept — The 5 Factors]**

Slide 1: "The Atlas Score in 5 factors."
Slide 2: "Momentum — Where's the price in its day range? 30% of the Score."
Slide 3: "Analyst Breadth — 8 Buys, 0 Sells is different from 4/4. 20%."
Slide 4: "News Momentum — Recent headlines, classified. 15%."
Slide 5: "Macro Alignment — Yield curve, VIX, rates. Your sector in context. 20%."
Slide 6: "Valuation — P/E percentile as a guardrail. 15%."
Slide 7: "One Score. Five factors. Every stock. Every morning. atlasanalysis.net"

---

**[Story / Reel concept — Morning routine]**

Hook: "What does institutional equity research look like at 8am?"
Body: Fast cut — sector cards loading, Atlas Score numbers populating, price tickers, sentiment labels
CTA: "Before 9:30 ET. Every morning. atlasanalysis.net"
Duration: 15s

---
