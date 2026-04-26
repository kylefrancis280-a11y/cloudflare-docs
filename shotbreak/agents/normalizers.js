// ═══════════════════════════════════════════════════════════════════════════
//  SHOTBREAK — Standardization Layers
//  Deterministic preprocessors. NOT agents. No API calls, no cost, no latency.
//  Every agent call in SHOTBREAK runs one of these first.
//
//  Exports (global window.SB_Normalize):
//    normalizeScript(rawText)              → NormalizedScript
//    standardizeCharacterBrief(text, ctx)  → CharacterSpec
//    standardizeShotBrief(text)            → {shot, action, mood}
//    standardizeBrief(idea)                → ProjectBrief
// ═══════════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── 1. Script normalizer ────────────────────────────────────────────
  // Goal: take any dump (title page + revision marks + prose + stage plays
  // + Fountain + the copy of Chinatown someone downloaded from simplyscripts)
  // and emit { title, scenes: [...] } — every scene cleanly structured.
  function normalizeScript(raw) {
    if (!raw || typeof raw !== 'string') return { title: '', scenes: [], format_detected: 'empty' };

    // ── A. Global cleanup ────────────────────────────────────────────
    let text = raw
      .replace(/\r\n/g, '\n').replace(/\r/g, '\n')   // unify line endings
      .replace(/\u00A0/g, ' ')                        // nbsp → space
      .replace(/\u2013|\u2014/g, '-')                 // en/em dash → hyphen
      .replace(/[\u2018\u2019]/g, "'")                // smart single quotes
      .replace(/[\u201C\u201D]/g, '"')                // smart double quotes
      .replace(/\t/g, '    ');                        // tabs → 4 spaces

    // ── A2. Strip markdown formatting so character cues parse cleanly ─
    // Handles scripts pasted from Claude's output, markdown editors, or
    // user formatting (e.g. **SULLIVAN** inside `>` blockquote lines).
    text = text
      .replace(/^>\s?/gm, '')                         // strip `>` blockquote markers
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')            // **bold** → bold
      .replace(/__([^_\n]+)__/g, '$1')                // __bold__ → bold
      .replace(/(?<!\*)\*(?!\*)([^*\n]+?)\*(?!\*)/g, '$1') // *italic* → italic
      .replace(/(?<!_)_(?!_)([^_\n]+?)_(?!_)/g, '$1') // _italic_ → italic
      .replace(/^#{1,6}\s+/gm, '')                    // # headings → plain
      .replace(/^[-=*]{3,}\s*$/gm, '')                // --- / === / *** horizontal rules
      .replace(/^\|.*\|$/gm, '')                      // markdown table rows — discard
      .replace(/`([^`\n]+)`/g, '$1');                 // `inline code` → plain

    // ── B. Extract title + preserve meaningful preamble content ──────
    // Everything before the FIRST scene heading is usually title-page junk —
    // we grab a title heuristic from it. BUT: if the preamble has substantial
    // content (dialogue, action paragraphs, character cues), we keep it as an
    // implicit opening scene. This handles "OPENING SEQUENCE" style headers
    // that sit before the first INT./EXT. slug but contain real content.
    let title = '';
    const slugRegex = /^\s*(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|E\/I\.)\s+/im;
    const firstSlugMatch = text.match(slugRegex);
    if (firstSlugMatch) {
      const preamble = text.slice(0, firstSlugMatch.index);
      // Heuristic title: first non-empty line that isn't "By ..." / "FADE IN"
      const preLines = preamble.split('\n').map(s => s.trim()).filter(Boolean);
      let titleLineIndex = -1;
      for (let idx = 0; idx < preLines.length; idx++) {
        const line = preLines[idx];
        const up = line.toUpperCase();
        if (up === 'FADE IN:' || up === 'FADE IN' || up.startsWith('BY ') ||
            up.startsWith('WRITTEN BY') || up.startsWith('SCREENPLAY BY') ||
            /^DRAFT\b|^FINAL\b|^REVISION\b|^REV\b|^\(/.test(up) ||
            /^\d+\./.test(line) || line.length < 3) continue;
        title = line.replace(/\s+/g, ' ').replace(/^"|"$/g, '').slice(0, 120);
        titleLineIndex = idx;
        break;
      }
      // Does the preamble contain substantial content beyond the title line?
      // Heuristic: if the non-title preamble is > 200 chars OR has any
      // all-caps character cue followed by dialogue, keep it as an implicit
      // opening scene. We prepend a synthetic "INT. OPENING - NIGHT" header
      // so the scene parser picks it up.
      const contentLines = preLines.filter((_, idx) => idx !== titleLineIndex);
      const contentText = contentLines.join('\n').trim();
      const hasCue = /\n[A-Z][A-Z\s\.\-']{1,38}\n/.test('\n' + contentText);
      const isSubstantial = contentText.length > 200 || hasCue;
      if (isSubstantial) {
        // Detect an existing section header (OPENING SEQUENCE, etc.) to use as slug.
        let slugLabel = 'OPENING';
        const firstContent = contentLines[0] || '';
        if (/^[A-Z][A-Z\s]{2,40}$/.test(firstContent) && firstContent.length < 50) {
          slugLabel = firstContent.trim();
        }
        const syntheticHeader = `INT. ${slugLabel} - DAY\n\n`;
        text = syntheticHeader + contentText + '\n\n' + text.slice(firstSlugMatch.index);
      } else {
        text = text.slice(firstSlugMatch.index);
      }
    }

    // ── C. Strip revision marks, production notes, page numbers ──────
    text = text
      .replace(/^\s*\(\s*(CONTINUED|MORE|CONT'D)\s*\)\s*$/gmi, '')  // (CONTINUED), (MORE), (CONT'D)
      .replace(/^\s*CONTINUED:?\s*(\(\d+\))?\s*$/gmi, '')            // CONTINUED line
      .replace(/^\s*\d{1,4}\.?\s*$/gm, '')                           // bare page numbers
      .replace(/^\s*\*\s*$/gm, '')                                   // lone revision asterisks
      .replace(/^\s*Page\s+\d+(\s+of\s+\d+)?\s*$/gmi, '')            // "Page N of M"
      .replace(/^\s*\*?\s*Rev\.?\s*(Blue|Pink|Yellow|Green|Goldenrod|Buff|Salmon|Cherry|White|Tan)\b.*$/gmi, '')
      .replace(/\n{3,}/g, '\n\n');

    // ── D. Detect format ─────────────────────────────────────────────
    const hasSlugs = /\n(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.)\s/i.test(text);
    const hasCapsDialogue = /\n\s{2,}[A-Z][A-Z\s\.\-']+$/m.test(text);
    const hasFountainSlug = /\n\.[A-Z]/.test(text);
    let format = 'prose';
    if (hasSlugs && hasCapsDialogue) format = 'screenplay';
    else if (hasSlugs) format = 'screenplay-loose';
    else if (hasFountainSlug) format = 'fountain';

    // ── E. Parse scenes ──────────────────────────────────────────────
    const scenes = [];
    if (format === 'prose') {
      // No slugs to split on — treat each paragraph block as one "scene".
      // Lower threshold from 40 to 15 chars so dialogue-only paragraphs
      // (e.g. 'JACK: I shouldn't have taken the case.') aren't filtered out.
      const rawBlocks = text.split(/\n\s*\n+/).map(b => b.trim()).filter(b => b.length > 15);
      // Merge consecutive short blocks into semantic chunks — a block under
      // 80 chars gets merged with the next one, so dialogue + its response
      // aren't split across multiple "scenes" unnecessarily.
      const blocks = [];
      let pending = '';
      for (const b of rawBlocks) {
        if (pending) { blocks.push((pending + '\n\n' + b).trim()); pending = ''; }
        else if (b.length < 80) { pending = b; }
        else blocks.push(b);
      }
      if (pending) blocks.push(pending);
      blocks.forEach((block, i) => {
        scenes.push({
          id: 'sc_' + String(i + 1).padStart(3, '0'),
          slug: 'SCENE ' + (i + 1),
          setting: { type: 'unknown', location: '' },
          time: '',
          characters_present: extractCharacters(block),
          action: block,
          dialogue: [],
          raw: block,
        });
      });
    } else {
      // Split by scene heading lines
      const lines = text.split('\n');
      let currentSceneLines = [];
      let currentSlug = null;

      const flushScene = () => {
        if (!currentSlug) return;
        const body = currentSceneLines.join('\n').trim();
        const parsed = parseSceneBody(body);
        scenes.push({
          id: 'sc_' + String(scenes.length + 1).padStart(3, '0'),
          slug: currentSlug,
          setting: parseSlug(currentSlug),
          time: parseTimeOfDay(currentSlug),
          characters_present: parsed.characters,
          action: parsed.action,
          dialogue: parsed.dialogue,
          raw: body,
        });
      };

      const slugDetect = /^\s*(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|E\/I\.)\s+.+$/i;
      for (const line of lines) {
        const trim = line.trim();
        if (slugDetect.test(trim) || (format === 'fountain' && /^\.\S/.test(trim))) {
          flushScene();
          currentSlug = trim.replace(/^\./, '');
          currentSceneLines = [];
        } else {
          currentSceneLines.push(line);
        }
      }
      flushScene();
    }

    // Final safety net: run a global character extraction on the full
    // normalized text. This catches characters that per-scene parsing may
    // have missed due to scene-boundary artifacts, orphaned cues, or
    // unusual formatting. Union with per-scene detections.
    const globalChars = extractCharacters(text);

    // Build a rejection set of known location names from all scene slugs —
    // any candidate matching a location should NEVER be treated as a character.
    // Catches unusual location words (RAIN-SOAKED ALLEY, DETECTIVE'S OFFICE, etc.)
    const locationWords = new Set();
    scenes.forEach(s => {
      const loc = (s.setting?.location || '').trim();
      if (!loc) return;
      // Add each word from the location as a potential reject
      loc.split(/[\s\-\—,\/]+/).forEach(w => {
        const up = w.replace(/[^\w]/g, '').toUpperCase();
        if (up.length >= 3) locationWords.add(up);
      });
      // Also add the full location string uppercase
      locationWords.add(loc.toUpperCase().replace(/[^\w\s]/g, '').trim());
    });

    // Filter out candidates that match known location words.
    const filteredGlobal = globalChars.filter(name => {
      const upper = name.toUpperCase();
      if (locationWords.has(upper)) return false;
      // Reject multi-word candidates where all words match location tokens
      const words = upper.split(/\s+/);
      if (words.length > 1 && words.every(w => locationWords.has(w))) return false;
      return true;
    });

    // Also filter per-scene character lists for the same reason
    scenes.forEach(s => {
      s.characters_present = s.characters_present.filter(name => {
        const upper = name.toUpperCase();
        if (locationWords.has(upper)) return false;
        const words = upper.split(/\s+/);
        if (words.length > 1 && words.every(w => locationWords.has(w))) return false;
        return true;
      });
    });

    return {
      title: title || '(Untitled)',
      format_detected: format,
      scenes,
      scene_count: scenes.length,
      character_list: collectAllCharacters(scenes, filteredGlobal),
    };
  }

  function parseSlug(slug) {
    // Match INT./EXT. prefix, then location (up to whitespace-wrapped dash),
    // then optional time. Using whitespace-required separator preserves
    // hyphenated locations like "RAIN-SOAKED ALLEY" or "24-HOUR DINER".
    const m = slug.match(/^(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.|E\/I\.)\s+(.+?)(?:\s+[-\u2013—]\s+(.+))?$/i);
    if (!m) return { type: 'unknown', location: slug };
    const prefix = m[1].toUpperCase();
    const type = prefix.startsWith('INT.') ? 'interior'
               : prefix.startsWith('EXT.') ? 'exterior'
               : 'both';
    return { type, location: (m[2] || '').trim() };
  }

  function parseTimeOfDay(slug) {
    const m = slug.match(/[-\u2013—]\s*(.+)$/);
    if (!m) return '';
    const tag = m[1].trim().toLowerCase();
    // Normalize common times
    if (/\bdawn|sunrise\b/.test(tag))          return 'dawn';
    if (/\bday|morning|afternoon\b/.test(tag)) return 'day';
    if (/\bdusk|sunset|magic hour\b/.test(tag))return 'dusk';
    if (/\bnight|evening\b/.test(tag))         return 'night';
    if (/\bcontinuous|moments later\b/.test(tag)) return 'continuous';
    return tag;
  }

  // ── Common English words that should NEVER be treated as character names.
  // Used to filter proper-name extraction in prose and fallback detection.
  const STOPWORDS = new Set([
    'INT','EXT','FADE','CUT','SMASH','MATCH','DISSOLVE','CONTINUED','MORE',
    'THE','A','AN','OF','IN','ON','AT','TO','FROM','WITH','FOR','AND','OR',
    'BUT','AS','IS','WAS','ARE','BE','HAS','HAD','HE','SHE','IT','THEY','WE',
    'NIGHT','DAY','DAWN','DUSK','MORNING','EVENING','AFTERNOON','LATER',
    'CONTINUOUS','SIMULTANEOUS','MOMENTS','SAME','MEANWHILE','AGAIN',
    'ACT','SCENE','CHAPTER','END','BEGIN','OVER','UP','DOWN','OUT',
    'POV','VO','OS','OC','CONT','CONTD','INTERIOR','EXTERIOR',
    'TITLE','CREDITS','MONTAGE','FLASHBACK','INTERCUT','SERIES','SHOTS',
    'CLOSE','WIDE','MEDIUM','TIGHT','EXTREME','HIGH','LOW','ANGLE',
    'FRAME','SHOT','TWO','THREE','FOUR','INSERT','REVEAL',
    // Section/sequence header words (commonly confused with character names)
    'OPENING','CLOSING','PROLOGUE','EPILOGUE','SEQUENCE','PART','EPISODE',
    'INTRO','OUTRO','FINAL','FIRST','SECOND','THIRD','PREVIOUSLY','BEFORE',
    'AFTER','NOW','THEN','MEANWHILE','ELSEWHERE','LATER',
    // Pronouns / very common words that shouldn't be names
    'YOU','ME','HIM','HER','THEM','US','MY','YOUR','HIS','THEIR','OUR',
    'THIS','THAT','THESE','THOSE','WHO','WHAT','WHEN','WHERE','WHY','HOW',
    // Common location words that leak from scene headers as false-positive characters
    'OFFICE','HOUSE','APARTMENT','ROOM','KITCHEN','BEDROOM','BATHROOM',
    'LIVING','DINING','HALL','HALLWAY','STAIRWAY','STAIRCASE','BASEMENT',
    'ATTIC','GARAGE','YARD','GARDEN','STREET','ALLEY','PARK','HIGHWAY',
    'ROAD','CAFE','RESTAURANT','BAR','CLUB','HOTEL','LOBBY','ELEVATOR',
    'WAREHOUSE','FACTORY','STORE','SHOP','SCHOOL','CHURCH','TEMPLE',
    'HOSPITAL','PRISON','CELL','COURTROOM','CLASSROOM','STATION',
    'AIRPORT','SUBWAY','BUS','CAR','TRUCK','BOAT','PLANE',
    'BEACH','FOREST','MOUNTAIN','DESERT','RIVER','LAKE','OCEAN',
    'CITY','TOWN','VILLAGE','SUBURB','DOWNTOWN','UPTOWN','DISTRICT',
    // Weather / atmosphere
    'RAIN','SNOW','FOG','STORM','WIND','SUN','MOON','SKY',
    // Materials / generic descriptors
    'SOAKED','WET','DRY','COLD','HOT','WARM','DARK','LIGHT','BRIGHT',
    'NEON','SODIUM','FLUORESCENT','CANDLELIT',
    // Scene markers
    'BLACK','WHITE','GRAY','GREY','RED','GREEN','BLUE','GOLD','SILVER'
  ]);

  function isLikelyCharacterName(name) {
    if (!name) return false;
    const n = name.trim();
    if (n.length < 2 || n.length > 40) return false;
    // All-caps single words that are stopwords → reject
    if (STOPWORDS.has(n.toUpperCase().replace(/[.'\-]/g, ''))) return false;
    // Must start with uppercase letter
    if (!/^[A-Z]/.test(n)) return false;
    // No digits
    if (/\d/.test(n)) return false;
    return true;
  }

  function parseSceneBody(body) {
    // Multi-pattern scene body parser. Detects character cues in several
    // common formats so the normalizer works on any user's script style:
    //   1. Classic screenplay:       SULLIVAN\n    dialogue...
    //   2. Colon-terminated caps:    SULLIVAN: dialogue
    //   3. Colon-terminated mixed:   Sullivan: dialogue
    //   4. Caps + parenthetical:     SULLIVAN (V.O.)\n    dialogue
    //   5. Inline prose attribution: "Keep your gun," Sullivan said.
    const lines = body.split('\n');
    const action = [];
    const dialogue = [];
    const characters = new Set();

    // Regexes for character cue detection
    // A standalone ALL-CAPS cue line (classic screenplay)
    const cueAllCaps      = /^([A-Z][A-Z\s\.\-']{1,38})(\s*\([^)]+\))?$/;
    // "NAME:" or "Name:" style cue (novice/stage-play style)
    const cueColon        = /^([A-Z][A-Za-z\s\.\-']{1,38})(\s*\([^)]+\))?\s*:\s*(.*)$/;
    // ALL-CAPS name followed by a colon (hybrid)
    const cueAllCapsColon = /^([A-Z][A-Z\s\.\-']{1,38})(\s*\([^)]+\))?\s*:\s*(.*)$/;

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trim = line.trim();

      if (!trim) { i++; continue; }

      let matched = false;
      let name = null;
      let inlineDialogue = '';
      let paren = '';

      // Pattern 1: pure all-caps cue line (line IS the cue, dialogue follows)
      if (cueAllCaps.test(trim) && trim === trim.toUpperCase() && trim.length < 42) {
        const m = trim.match(cueAllCaps);
        const cand = m[1].trim();
        if (isLikelyCharacterName(cand)) {
          name = cand;
          if (m[2]) paren = m[2].trim().replace(/^\(|\)$/g, '');
          matched = true;
        }
      }

      // Pattern 2 + 4: NAME: or Name: style — dialogue on same line
      if (!matched) {
        const mColon = trim.match(cueAllCapsColon) || trim.match(cueColon);
        if (mColon) {
          const cand = mColon[1].trim();
          // Reject if this looks like a prose sentence (lots of lowercase words after a proper name)
          // Real dialogue cues have short name + immediate dialogue after colon.
          if (isLikelyCharacterName(cand) && cand.split(/\s+/).length <= 4) {
            name = cand;
            if (mColon[2]) paren = mColon[2].trim().replace(/^\(|\)$/g, '');
            inlineDialogue = (mColon[3] || '').trim();
            matched = true;
          }
        }
      }

      if (matched && name) {
        // Normalize name to ALL CAPS for consistency (matches classic format)
        const canonicalName = name.toUpperCase();

        // Collect dialogue lines until blank line or next cue
        const dialLines = [];
        if (inlineDialogue) dialLines.push(inlineDialogue);

        let j = i + 1;
        while (j < lines.length) {
          const lj = lines[j];
          const tj = lj.trim();
          if (!tj) { j++; break; }
          // Next cue starts here — stop gathering
          if (
            (cueAllCaps.test(tj) && tj === tj.toUpperCase() && tj.length < 42) ||
            cueAllCapsColon.test(tj) ||
            cueColon.test(tj)
          ) break;
          // Handle standalone parenthetical on its own line
          if (/^\(.+\)$/.test(tj) && !paren) {
            paren = tj.slice(1, -1);
            j++; continue;
          }
          dialLines.push(tj);
          j++;
        }
        // Only register as a character if dialogue actually followed the cue.
        // Without this, section headers like "OPENING SEQUENCE" or "MONTAGE"
        // sitting alone on a line with only action paragraphs below get
        // incorrectly treated as character names.
        if (dialLines.length) {
          characters.add(canonicalName);
          dialogue.push({ character: canonicalName, parenthetical: paren || null, line: dialLines.join(' ') });
          i = j;
        } else {
          // Not a real character cue — treat the line as action and continue.
          action.push(trim);
          i++;
        }
      } else {
        action.push(trim);
        i++;
      }
    }

    // Fallback: if we parsed the body and found ZERO characters from cues,
    // try inline-prose attribution: "Sullivan said", "said Sullivan",
    // "Sullivan replied", etc. Common in novella-style writing.
    if (characters.size === 0) {
      const actionText = action.join(' ');
      const proseAttribution = [
        /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,1})\s+(?:said|says|asked|replied|whispered|shouted|muttered|sighed|answered|responded)\b/g,
        /\b(?:said|says|asked|replied|whispered|shouted|muttered|sighed|answered|responded)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,1})\b/g,
      ];
      proseAttribution.forEach(re => {
        let m;
        while ((m = re.exec(actionText)) !== null) {
          const cand = m[1].trim();
          if (isLikelyCharacterName(cand)) characters.add(cand.toUpperCase());
        }
      });
    }

    return {
      characters: [...characters],
      action: action.join(' '),
      dialogue,
    };
  }

  function extractCharacters(block) {
    // Prose-mode fallback character extractor. Multiple detection passes:
    //   Pass 1: proper names appearing 2+ times (original heuristic)
    //   Pass 2: names in dialogue attribution phrases (any frequency, strong signal)
    //   Pass 3: all-caps character labels (SULLIVAN)
    //   Pass 4: colon-style character cues (NAME: or Name: — stage-play style)
    const names = new Map();

    // Pass 1 — proper-name frequency
    const re1 = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/g;
    let m;
    while ((m = re1.exec(block)) !== null) {
      const n = m[1];
      if (n.length < 3) continue;
      // Reject if first word is stopword (e.g. "The Morning")
      const firstWord = n.split(/\s+/)[0].toUpperCase();
      if (STOPWORDS.has(firstWord)) continue;
      names.set(n, (names.get(n) || 0) + 1);
    }

    // Pass 2 — dialogue attribution (any frequency; strong signal)
    const attribution = [
      /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\s+(?:said|says|asked|replied|whispered|shouted|muttered|sighed|answered|responded|called|cried|yelled|murmured|growled|snapped|spat|grinned|smiled|frowned|laughed)\b/g,
      /\b(?:said|says|asked|replied|whispered|shouted|muttered|sighed|answered|responded|called|cried|yelled|murmured|growled|snapped|spat)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})\b/g,
    ];
    attribution.forEach(re => {
      let mm;
      while ((mm = re.exec(block)) !== null) {
        const n = mm[1];
        if (!isLikelyCharacterName(n)) continue;
        names.set(n, (names.get(n) || 0) + 3);
      }
    });

    // Pass 3 — all-caps words that look like character labels ("SULLIVAN")
    const re3 = /\b([A-Z]{3,}(?:\s[A-Z]{3,}){0,2})\b/g;
    while ((m = re3.exec(block)) !== null) {
      const n = m[1];
      if (!isLikelyCharacterName(n)) continue;
      names.set(n, (names.get(n) || 0) + 2);
    }

    // Pass 4 — colon-style cues at line starts: "NAME:" or "Name:" in prose.
    // Very strong signal — treat as 3+ occurrences so single cues survive filter.
    const lines = block.split('\n');
    lines.forEach(line => {
      const trim = line.trim();
      const colonMatch = trim.match(/^([A-Z][A-Za-z\s\.\-']{1,38})(\s*\([^)]+\))?\s*:\s*\S/);
      if (colonMatch) {
        const cand = colonMatch[1].trim();
        // Must be 1-4 words and pass the name filter
        if (cand.split(/\s+/).length <= 4 && isLikelyCharacterName(cand)) {
          names.set(cand, (names.get(cand) || 0) + 5);
        }
      }
    });

    // Filter: keep names appearing 2+ times (or 1x with strong signal weighted).
    // Return in canonical ALL-CAPS form for consistency with parseSceneBody.
    // Also dedupe case-insensitively to avoid "Sullivan" and "SULLIVAN" both.
    const canonical = new Map();
    [...names.entries()]
      .filter(([, c]) => c >= 2)
      .forEach(([n, c]) => {
        const upper = n.toUpperCase();
        if (!canonical.has(upper) || canonical.get(upper) < c) canonical.set(upper, c);
      });
    return [...canonical.keys()];
  }

  function collectAllCharacters(scenes, globalChars) {
    const all = new Map();
    scenes.forEach(s => {
      s.characters_present.forEach(c => {
        all.set(c, (all.get(c) || 0) + 1);
      });
    });
    // Merge in global detections — any character found globally but not
    // per-scene gets added with a scenes_present_count of 1 as a fallback.
    if (Array.isArray(globalChars)) {
      globalChars.forEach(name => {
        if (!all.has(name)) all.set(name, 1);
      });
    }

    // Dedupe overlapping variants: if "JACK" and "JACK SULLIVAN" both exist,
    // or "WOMAN" and "THE WOMAN", merge their counts into the PRIMARY name
    // (the one with more scene presence, or the shorter form if equal).
    const entries = [...all.entries()];
    const canonical = new Map();
    const resolved = new Set();

    // Sort by count descending so primary forms are considered first
    entries.sort((a, b) => b[1] - a[1]);

    for (const [name, count] of entries) {
      if (resolved.has(name)) continue;
      const nameWords = new Set(name.split(/\s+/).filter(w => w && !['THE', 'A', 'AN'].includes(w)));

      // Find all other entries whose word set is a subset/superset of this one
      let primaryName = name;
      let primaryCount = count;
      const merged = [name];

      for (const [otherName, otherCount] of entries) {
        if (otherName === name || resolved.has(otherName)) continue;
        const otherWords = new Set(otherName.split(/\s+/).filter(w => w && !['THE', 'A', 'AN'].includes(w)));

        // Check if one is a word-subset of the other
        const nameInOther = [...nameWords].every(w => otherWords.has(w));
        const otherInName = [...otherWords].every(w => nameWords.has(w));

        if (nameInOther || otherInName) {
          // They're related — merge them
          merged.push(otherName);
          // Primary: higher count wins; tie-breaker = shorter (simpler) name
          if (otherCount > primaryCount ||
              (otherCount === primaryCount && otherName.length < primaryName.length)) {
            primaryName = otherName;
          }
          primaryCount += otherCount;
        }
      }

      merged.forEach(n => resolved.add(n));
      canonical.set(primaryName, Math.max(primaryCount, canonical.get(primaryName) || 0));
    }

    return [...canonical.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, scenes_present_count]) => ({ name, scenes_present_count }));
  }

  // ── 2. Character brief standardizer ──────────────────────────────────
  // Takes a raw (often sprawling) character description and compresses it
  // into a canonical 50-word-max spec that Character Sculptor & Prompt
  // Smith can reference consistently.
  function standardizeCharacterBrief(raw, context) {
    if (!raw) return { canonical: '', tags: {}, word_count: 0 };
    const text = String(raw).replace(/\s+/g, ' ').trim();

    // Extract common fields via pattern match (deterministic; Character
    // Sculptor does the creative polish later).
    const tags = {};
    const ageMatch = text.match(/\b(\d{1,2})\s*(?:-|to|–|—)?\s*(\d{1,2})?\s*years?\s*old\b/i) || text.match(/\b(?:age|aged)\s*(\d{1,2})\b/i);
    if (ageMatch) tags.age = ageMatch[1] + (ageMatch[2] ? '-' + ageMatch[2] : '');
    const buildMatch = text.match(/\b(tall|short|petite|lanky|muscular|wiry|stocky|heavyset|slim|athletic)\b/i);
    if (buildMatch) tags.build = buildMatch[1].toLowerCase();
    const hairMatch = text.match(/\b(blonde?|brunette|black[-\s]haired|red[-\s]haired|ginger|grey[-\s]haired|silver[-\s]haired|bald)\b/i);
    if (hairMatch) tags.hair = hairMatch[1].toLowerCase();
    const genderHint = text.match(/\b(man|woman|guy|girl|boy|elder(?:ly)?|grandmother|grandfather|male|female)\b/i);
    if (genderHint) tags.gender_hint = genderHint[1].toLowerCase();

    // Clip to ~50 words for canonical description
    const words = text.split(/\s+/).filter(Boolean);
    const canonical = words.slice(0, 50).join(' ') + (words.length > 50 ? '...' : '');

    return {
      canonical,
      tags,
      word_count: words.length,
      was_truncated: words.length > 50,
    };
  }

  // ── 3. Shot brief standardizer ───────────────────────────────────────
  // Splits one free-form shot description into the {shot, action, mood}
  // triple that Prompt Smith works best with.
  function standardizeShotBrief(raw) {
    if (!raw) return { shot: '', action: '', mood: '' };
    const text = String(raw).replace(/\s+/g, ' ').trim();

    // If user already split with "|" or labels like "Shot:", respect it.
    const labelled = parseLabelledTriple(text);
    if (labelled) return labelled;

    // Heuristic: first comma-segment is typically framing/shot, second is
    // action (contains a verb), third/rest is mood if any adj phrases.
    const segments = text.split(/[,\.]/).map(s => s.trim()).filter(Boolean);
    if (segments.length === 1) {
      return { shot: text, action: '', mood: '' };
    }
    if (segments.length === 2) {
      // Does second segment contain a verb-y word?
      const hasVerb = /\b(walks|runs|sits|stands|looks|watches|holds|opens|closes|falls|turns|enters|leaves|speaks|whispers|shouts|cries|laughs|types|drives|drinks|smokes|reads|writes|sleeps|wakes|reaches|grabs|hides|hunts|finds|loses|meets|stares|stalks|follows)\b/i.test(segments[1]);
      return hasVerb
        ? { shot: segments[0], action: segments[1], mood: '' }
        : { shot: segments[0], action: '',          mood: segments[1] };
    }
    // 3+ segments: first = shot, middle = action, last = mood
    return {
      shot: segments[0],
      action: segments.slice(1, -1).join(', '),
      mood: segments[segments.length - 1],
    };
  }

  function parseLabelledTriple(text) {
    const map = {};
    const patterns = [
      { key: 'shot',   re: /\bshot\s*[:=]\s*([^|;]+?)(?=\s*\||\s*;|\s*action\b|\s*mood\b|$)/i },
      { key: 'action', re: /\baction\s*[:=]\s*([^|;]+?)(?=\s*\||\s*;|\s*shot\b|\s*mood\b|$)/i },
      { key: 'mood',   re: /\bmood\s*[:=]\s*([^|;]+?)(?=\s*\||\s*;|\s*shot\b|\s*action\b|$)/i },
    ];
    let hits = 0;
    for (const p of patterns) {
      const m = text.match(p.re);
      if (m) { map[p.key] = m[1].trim(); hits++; }
    }
    if (hits >= 2) {
      return { shot: map.shot || '', action: map.action || '', mood: map.mood || '' };
    }
    // Pipe-separated: "framing | action | mood"
    if (text.includes('|')) {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length === 3) {
        return { shot: parts[0], action: parts[1], mood: parts[2] };
      }
    }
    return null;
  }

  // ── 4. Project brief standardizer (reverse mode) ─────────────────────
  // Takes a loose idea and prompts for missing structure. If enough
  // signal is present, returns a complete brief; else lists what's missing.
  function standardizeBrief(idea) {
    if (!idea) return { ready: false, missing: ['premise', 'genre', 'length', 'tone'] };
    const text = String(idea).trim();
    const missing = [];
    const brief = {
      premise: text.length > 20 ? text : null,
      genre: null,
      length_seconds: null,
      tone: null,
      references: [],
    };

    // Genre sniff
    const genres = ['noir', 'horror', 'thriller', 'romance', 'comedy', 'sci-fi', 'science fiction', 'fantasy', 'drama', 'western', 'documentary', 'action'];
    for (const g of genres) {
      if (new RegExp('\\b' + g + '\\b', 'i').test(text)) { brief.genre = g.replace('science fiction', 'sci-fi'); break; }
    }

    // Length sniff
    const lenMatch = text.match(/\b(\d+)\s*(second|sec|s|minute|min|m)s?\b/i);
    if (lenMatch) {
      const n = parseInt(lenMatch[1], 10);
      const unit = lenMatch[2].toLowerCase();
      brief.length_seconds = unit.startsWith('m') ? n * 60 : n;
    }

    // Reference films
    const refMatch = text.match(/\blike\s+([^,.;!?]+)/gi);
    if (refMatch) {
      brief.references = refMatch.map(r => r.replace(/^\s*like\s+/i, '').trim()).slice(0, 3);
    }

    // Tone sniff
    const toneWords = ['dark', 'light', 'comedic', 'serious', 'melancholic', 'uplifting', 'tense', 'dreamy', 'gritty'];
    for (const t of toneWords) {
      if (new RegExp('\\b' + t + '\\b', 'i').test(text)) { brief.tone = t; break; }
    }

    if (!brief.premise) missing.push('premise');
    if (!brief.genre) missing.push('genre');
    if (!brief.length_seconds) missing.push('length');
    if (!brief.tone) missing.push('tone');

    return {
      ready: missing.length === 0,
      missing,
      brief,
    };
  }

  // ── Export ───────────────────────────────────────────────────────────
  window.SB_Normalize = {
    normalizeScript,
    standardizeCharacterBrief,
    standardizeShotBrief,
    standardizeBrief,
  };
})();
