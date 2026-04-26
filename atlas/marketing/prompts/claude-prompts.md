# Atlas Analysis — Claude Marketing Prompts

These prompts are designed to be used directly with Claude (claude.ai or API) to generate, refine, or extend Atlas marketing content. Each prompt is self-contained and references Atlas-specific context inline.

---

## Prompt Library

### 1. Landing Page Variant Generator

```
You are a direct-response copywriter. Your audience is self-directed retail investors who are data-literate but not institutional professionals. They know what a yield curve is. They're skeptical of hype.

Product context:
- Atlas Analysis is an AI-powered stock research platform
- URL: atlasanalysis.net
- Pricing: CA$29.99/mo (Core), CA$49.99/mo (Pro), CA$99.99/mo (Institutional)
- Key features: proprietary Atlas Score (22–97), daily analysis before 9:30am ET, 8 sectors (Mining, AI, Tech, Biotech, Energy, Defense, Media, Other), live prices, analyst consensus, Claude-written research notes
- The Atlas Score combines: momentum (30%), analyst breadth (20%), news momentum (15%), macro alignment (20%), valuation P/E (15%)
- Macro alignment is the differentiator: the platform weights sectors differently based on yield curve, VIX, and Fed funds regime
- Powered by Claude Sonnet 4.6 with prompt caching for cost efficiency

Task:
Write 3 alternative hero section variants (headline + subheadline + primary CTA) for the Atlas Analysis landing page. Each variant should emphasize a different core benefit:
Variant A: The macro context angle (yield curve, VIX, sector weighting)
Variant B: The timing angle (before market open, daily, automated)
Variant C: The pricing/access angle (institutional quality at retail price)

Format each variant as:
HEADLINE: [text]
SUB: [text]
CTA: [button text]
WHY IT WORKS: [1 sentence on the strategic rationale]

Rules:
- No emojis
- No superlatives without data to back them up ("best" without proof = cut)
- Specific beats general
- Under 20 words for headline, under 35 for subheadline
```

---

### 2. Email Subject Line Generator

```
You are an email marketer specializing in B2C SaaS for an investor audience. Write email subject lines for Atlas Analysis, an AI stock research platform.

Atlas context:
- Platform delivers daily stock analysis before 9:30am ET
- 8 sectors: Mining, AI, Tech, Biotech, Energy, Defense, Media, Other
- Proprietary Atlas Score (22–97) combining 5 real data factors
- Pricing: CA$29.99/mo Core, CA$49.99/mo Pro
- Target user: active retail investors, self-directed traders, angel investors

Generate 10 subject lines for the following email type: [INSERT EMAIL TYPE]

Email types to choose from:
- Welcome (just signed up for trial)
- Day 3 of trial (educational)
- Trial ending in 24 hours
- Post-purchase day 1
- Monthly check-in (30 days in)
- Churn win-back (day 3 after cancel)
- Core → Pro upgrade prompt
- Black Friday annual plan promotion

For each subject line also provide:
- Preview text (under 80 characters)
- Open rate prediction label: High / Medium / Low and one-sentence reason

Format:
1. Subject: [text]
   Preview: [text]
   Prediction: [High/Medium/Low] — [reason]

Rules:
- No all-caps except single words for emphasis
- No "RE:" tricks or fake urgency ("URGENT", "ACT NOW")
- Question subjects only if they're genuinely interesting to the reader
- Specific numbers beat adjectives ("74 vs. 35" beats "much higher")
- Under 50 characters for subject, under 80 for preview
```

---

### 3. Social Media Post Generator

```
You are a social media writer for Atlas Analysis, an AI-powered stock research platform. Audience: data-literate retail investors on X (Twitter).

Platform facts:
- Atlas Score = 5 factors: momentum (30%), analyst breadth (20%), news momentum (15%), macro alignment (20%), P/E valuation (15%)
- 8 sectors: Mining, AI, Tech, Biotech, Energy, Defense, Media, Other
- Daily analysis before market open (9:30am ET)
- Powered by Claude Sonnet 4.6 with prompt caching
- Pricing: CA$29.99/mo (Core) to CA$99.99/mo (Institutional)
- TSX and NYSE coverage; TSX-deep for Mining/Energy
- Macro alignment: defense scores up when VIX > 22; tech scores down when rates are high; mining adjusts to yield curve

Brand voice rules:
- No hype, no rocket emojis, no "moon" language
- Specific numbers beat adjectives
- Honest about what the platform does and doesn't do
- Never imply price prediction — always say "factors" or "signals"
- Short sentences. One idea per paragraph.

Task:
Write [NUMBER] X posts on the topic: [TOPIC]

Topics to choose from:
- How the Atlas Score works (educational thread, 5–7 posts)
- Macro alignment by sector (educational, 3–5 posts)
- Why daily timing matters (1–2 posts)
- Platform pricing / value prop (1–2 posts, soft sell)
- Engagement question (1 post to drive replies)
- Product feature spotlight: real-time prices (1–2 posts, Pro tier)
- Product feature spotlight: backtest track record (1–2 posts, Pro tier)
- Sector intro: [specific sector] (1 post)

Each post:
- Under 280 characters
- No hashtags unless specifically requested
- End with atlasanalysis.net only if it's a conversion post

Format:
POST [N]:
[text]
---
```

---

### 4. Ad Copy A/B Test Generator

```
You are a performance marketing copywriter. Write Google Search ad variants for Atlas Analysis, an AI stock research platform.

Product:
- Daily AI-generated equity research across 8 sectors (Mining, AI, Tech, Biotech, Energy, Defense, Media, Other)
- Proprietary Atlas Score (22–97) — not a black box, built from 5 data factors
- Analysis lands before 9:30am ET every morning
- TSX + NYSE coverage
- Pricing: CA$29.99/mo (Core), CA$49.99/mo (Pro), CA$99.99/mo (Institutional)
- 7-day free trial, cancel anytime
- URL: atlasanalysis.net

Target keywords for this campaign: [INSERT KEYWORD CLUSTER]

Example keyword clusters:
- "stock research tools" / "equity research platform" / "AI stock analysis"
- "TSX stock research" / "Canadian stock analysis"  
- "stock screener alternative" / "seeking alpha alternative"
- "morning stock research" / "pre-market analysis"

Write 3 complete responsive search ad sets. Each set:
- 5 headlines (max 30 characters each)
- 2 descriptions (max 90 characters each)
- 1 display URL path (max 15 chars each path)

Label which headlines are strong for which positions (H1, H2, H3) and why.

After the ads, write 2-sentence targeting notes: which audience signals, in-market categories, or similar audiences would you layer on this campaign?

Format:
AD SET [N]:
H1 (pinned): [text]
H2: [text]
H3: [text]
H4: [text]
H5: [text]
D1: [text]
D2: [text]
Path: atlasanalysis.net/[path]
Notes: [targeting]
```

---

### 5. Objection Handler Copy Generator

```
You are a conversion copywriter. Generate FAQ and objection-handling copy for Atlas Analysis.

Objections to address (choose any):
- "How is this different from just using ChatGPT to analyze stocks?"
- "I already have a Bloomberg/Refinitiv subscription — why do I need this?"
- "Isn't AI stock analysis just pattern-matching on historical data?"
- "What happens if the macro assumptions are wrong?"
- "CA$29.99/mo seems expensive for what I might already be doing manually."
- "I don't invest in TSX stocks. Is this useful for US-only investors?"
- "I'm worried about relying on AI for investment decisions."
- "How do I know the Atlas Score is actually predictive?"

For each objection:
1. Restate the objection honestly (don't strawman it)
2. Write the Atlas response (max 80 words)
3. Optional: suggest where in the funnel to use this copy (FAQ, sales page, email, retargeting ad)

Atlas facts to draw from:
- Atlas Score is built from deterministic, verifiable factors — not a generative black box
- Claude reads real data (prices, analyst recs, news, macro snapshot, SEC filings) and writes narrative against a strict JSON schema
- Macro alignment is explicit, rule-based sector weighting — not inferred
- Nothing on the platform is investment advice
- Track record view available in Pro tier (backtest data)
- TSX coverage is deep for Mining, Energy — NYSE for AI, Tech, Biotech, Defense, Media
- The platform is built by traders who use it themselves

Format:
OBJECTION: [text]
RESTATE: [honest version]
RESPONSE: [Atlas copy]
USE WHERE: [placement suggestion]
```

---

### 6. Press / Announcement Copy Generator

```
You are a tech PR writer. Write a product announcement for Atlas Analysis.

Announcement type: [INSERT TYPE]

Types to choose from:
- Platform launch (new product going live)
- Major feature launch (e.g., real-time SSE price streaming, backtest track record)
- Sector expansion (adding a new sector)
- Partnership or data source announcement
- Pricing change or new tier launch
- Funding or milestone announcement

Atlas context:
- Product: AI-powered stock research platform
- URL: atlasanalysis.net
- Stack: Cloudflare Workers, D1 database, Claude Sonnet 4.6, Polygon (prices), Finnhub (fallback), Stripe (billing)
- Sectors: Mining, AI, Tech, Biotech, Energy, Defense, Media
- Pricing: CA$29.99/mo Core → CA$99.99/mo Institutional
- Key differentiator: macro alignment built into every score; daily analysis before market open; transparent 5-factor scoring

Write:
1. Press release headline (under 100 characters)
2. Subheadline (1 sentence)
3. Lede paragraph (who, what, when, where, why — 2–3 sentences)
4. Product detail paragraph (2–3 sentences, technical credibility)
5. Founder quote (60–80 words, sounds like a builder, not a marketer)
6. Availability and pricing line (1 sentence)
7. Boilerplate (Atlas Analysis About section, 3 sentences)

Rules:
- No passive voice
- No "delighted to announce" or "excited to share"
- Specific beats vague — include real numbers where possible
- Quote should not repeat what the lede already said
```

---

### 7. Testimonial / Review Request Generator

```
You are a customer success writer for Atlas Analysis. Write outreach messages to satisfied users requesting a testimonial.

User segment: [INSERT SEGMENT]

Segments:
- Active Core user, 30+ days in, high login frequency
- Pro user who upgraded from Core within first month
- Institutional user (high-value, handle carefully)
- User who cancelled and came back
- Power user in Mining/Energy sector (TSX focus)

For each segment, write:
1. In-app prompt (under 60 words, shown after a positive action like saving a ticker or completing a week of logins)
2. Email outreach (subject + body, casual, specific, under 150 words)
3. Review request for Apple App Store / Google Play (if mobile app exists) or Product Hunt

Guidelines:
- Don't say "if you love Atlas" — assume they like it because they're still here
- Make the ask specific: what kind of quote would actually help ("what changed about your morning research routine")
- Offer something in return if appropriate (one free month, Pro upgrade trial)
- Never offer money for reviews

Format:
SEGMENT: [name]
IN-APP PROMPT: [text]
EMAIL SUBJECT: [text]
EMAIL BODY: [text]
REVIEW REQUEST: [text]
```

---

### 8. Referral Program Copy Generator

```
You are a growth copywriter. Write referral program copy for Atlas Analysis.

Referral structure (choose one or invent appropriate):
- Option A: Give 1 month free, Get 1 month free (classic two-sided)
- Option B: Give 30% off first month, Get CA$15 credit (one-sided incentive skews to referrer)
- Option C: Flat cash — Give CA$10 off, Get CA$10 credit per referral (up to 3)

Atlas context:
- B2C SaaS, financial research tool
- Audience: self-directed investors, active traders
- Not investment advice — don't make referral copy sound like you're sending friends a stock tip service
- Tone: dry, smart, no hype

Write for Option [A/B/C]:
1. Program headline (under 10 words)
2. Program description (under 60 words, in-platform copy)
3. Referral share message (what the user sends — SMS/DM/email version, under 80 words)
4. Referred user landing page headline + body (under 100 words total)
5. Success/confirmation message (after first referral converts, under 30 words)

Rules:
- Never say "your friend" or "people you know" — say "traders in your network" or just "anyone you send it to"
- Financial product: do not imply Atlas helps people make money, only that it helps them research
- Keep it simple — referral programs fail because they're too complicated
```

---

## Prompt Usage Notes

**Temperature settings for each prompt type:**
- Landing page copy: 0.7 (some creative variation wanted)
- Email subjects: 0.8 (want diversity in options)
- Ad copy: 0.4 (need compliance-safe, consistent output)
- Objection handlers: 0.3 (factual accuracy matters most)
- Press releases: 0.5 (structured but with voice)
- Testimonial requests: 0.6 (needs warmth, can't be robotic)

**Prompt caching recommendation:**
When running multiple marketing tasks in one session, prepend Atlas context as a cached system prompt to avoid re-processing it on every call. The platform context block (~300 tokens) is a good candidate for `cache_control: { type: "ephemeral" }`.

**Iterating on outputs:**
After first generation, add any of these follow-up instructions:
- "Make it 30% shorter. Cut every adjective that doesn't add specificity."
- "Remove the word 'institutional' — find a different way to express quality without the corporate jargon."
- "Write a version for someone who already uses [competitor] and is considering switching."
- "Make the tone less formal. This should sound like a founder email, not a press release."
