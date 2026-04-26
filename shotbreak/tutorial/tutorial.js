/**
 * SHOTBREAK — Tutorial Engine
 * ═══════════════════════════════════════════════════════════════════════════
 * One engine. Four modes:
 *   1. Tour              → sequential overlay with highlighted elements
 *   2. Coachmark         → persistent gold dots with on-demand popovers
 *   3. Walkthrough       → animated demo with narration bar
 *   4. Docs              → content is in tours.js, renderer lives in /learn/
 *
 * State is persisted to localStorage under keys starting with `sb_tut_`.
 * Every mode respects a global "don't show again" preference.
 *
 * API:
 *   SB_Tutorial.startTour(tourId)           — launch a sequential tour
 *   SB_Tutorial.installCoachmarks(defs)     — mount gold dots on elements
 *   SB_Tutorial.playWalkthrough(id)         — fire demo walkthrough
 *   SB_Tutorial.seen(key)                   — check localStorage flag
 *   SB_Tutorial.markSeen(key)               — set localStorage flag
 *   SB_Tutorial.reset()                     — clear all tutorial state
 *
 * Content lives in /tutorial/tours.js → window.SB_Tours
 */
(function () {
  'use strict';

  const LS_PREFIX = 'sb_tut_';
  const seen = (key) => localStorage.getItem(LS_PREFIX + key) === '1';
  const markSeen = (key) => { try { localStorage.setItem(LS_PREFIX + key, '1'); } catch(e){} };
  const unmarkAll = () => {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(LS_PREFIX))
        .forEach(k => localStorage.removeItem(k));
    } catch(e){}
  };

  // ─────────────────────────────────────────────────────────────
  // TOUR — sequential overlay with highlighted targets
  // ─────────────────────────────────────────────────────────────
  function startTour(tourId, opts) {
    opts = opts || {};
    const tours = (window.SB_Tours && window.SB_Tours.tours) || {};
    const tour = tours[tourId];
    if (!tour) { console.warn('[tutorial] unknown tour:', tourId); return; }
    if (!opts.force && seen('tour_' + tourId)) return;

    // HARD SAFETY: never show a tour while the login screen is the active
    // screen. The overlay covers the whole viewport at z-index 9999 and
    // would intercept clicks on the login form, making Sign In unclickable.
    const loginScreen = document.getElementById('loginScreen');
    if (loginScreen && loginScreen.classList.contains('active')) {
      console.info('[tutorial] tour suppressed — login screen active');
      return;
    }

    // Also kill any lingering overlay from a previous aborted tour so we
    // never stack two at once.
    document.querySelectorAll('.sb-tut-overlay').forEach(el => el.remove());

    let i = 0;
    const steps = tour.steps || [];
    if (!steps.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'sb-tut-overlay';
    overlay.innerHTML = `
      <div class="sb-tut-dim"></div>
      <div class="sb-tut-spot"></div>
      <div class="sb-tut-card">
        <div class="sb-tut-kicker"><span class="sb-tut-kicker-dot"></span><span class="sb-tut-kicker-text"></span></div>
        <div class="sb-tut-title"></div>
        <div class="sb-tut-body"></div>
        <div class="sb-tut-foot">
          <div class="sb-tut-progress">
            <span class="sb-tut-prog-current">1</span> <span class="sb-tut-prog-sep">of</span> <span class="sb-tut-prog-total">${steps.length}</span>
          </div>
          <div class="sb-tut-actions">
            <button class="sb-tut-btn sb-tut-btn-ghost" data-action="skip">Skip</button>
            <button class="sb-tut-btn sb-tut-btn-ghost" data-action="prev">Back</button>
            <button class="sb-tut-btn sb-tut-btn-gold" data-action="next">Next →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const card     = overlay.querySelector('.sb-tut-card');
    const spot     = overlay.querySelector('.sb-tut-spot');
    const kicker   = overlay.querySelector('.sb-tut-kicker-text');
    const titleEl  = overlay.querySelector('.sb-tut-title');
    const bodyEl   = overlay.querySelector('.sb-tut-body');
    const curEl    = overlay.querySelector('.sb-tut-prog-current');
    const prevBtn  = overlay.querySelector('[data-action="prev"]');
    const nextBtn  = overlay.querySelector('[data-action="next"]');
    const skipBtn  = overlay.querySelector('[data-action="skip"]');

    function renderStep() {
      const s = steps[i];
      kicker.textContent = tour.name || 'Tour';
      titleEl.textContent = s.title || '';
      bodyEl.innerHTML = s.body || '';
      curEl.textContent = String(i + 1);
      prevBtn.style.visibility = i === 0 ? 'hidden' : 'visible';
      nextBtn.textContent = i === steps.length - 1 ? 'Got it ✓' : 'Next →';

      // Spotlight a target if provided and present — otherwise center the card
      // (degrades gracefully when a step references an off-screen element)
      if (s.target) {
        const el = typeof s.target === 'string' ? document.querySelector(s.target) : s.target;
        if (el) {
          // Ensure target is on-screen BEFORE measuring, then measure fresh
          el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          setTimeout(() => {
            const r = el.getBoundingClientRect();
            const pad = 8;
            spot.style.display = 'block';
            spot.style.top    = (r.top - pad) + 'px';
            spot.style.left   = (r.left - pad) + 'px';
            spot.style.width  = (r.width + pad * 2) + 'px';
            spot.style.height = (r.height + pad * 2) + 'px';
            positionCardNear(card, r, s.placement || 'auto');
          }, 260);
        } else {
          // Target missing — no spotlight, center the card and keep going
          console.warn('[tutorial] step ' + (i + 1) + ' target not found:', s.target);
          spot.style.display = 'none';
          centerCard(card);
        }
      } else {
        spot.style.display = 'none';
        centerCard(card);
      }
    }

    function positionCardNear(cardEl, rect, placement) {
      const cw = 420, ch = cardEl.offsetHeight || 240;
      const margin = 24;
      const vw = window.innerWidth, vh = window.innerHeight;
      let top, left;
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      const placeBelow = placement === 'bottom' || (placement === 'auto' && spaceBelow >= ch + margin);
      if (placeBelow) {
        top  = rect.bottom + margin;
        left = Math.min(Math.max(rect.left + rect.width / 2 - cw / 2, margin), vw - cw - margin);
      } else if (spaceAbove >= ch + margin) {
        top  = rect.top - ch - margin;
        left = Math.min(Math.max(rect.left + rect.width / 2 - cw / 2, margin), vw - cw - margin);
      } else {
        // fallback center
        centerCard(cardEl); return;
      }
      cardEl.style.top = top + 'px';
      cardEl.style.left = left + 'px';
      cardEl.style.transform = 'none';
    }
    function centerCard(cardEl) {
      cardEl.style.top = '50%';
      cardEl.style.left = '50%';
      cardEl.style.transform = 'translate(-50%, -50%)';
    }

    function finish(dismissed) {
      markSeen('tour_' + tourId);
      overlay.remove();
      if (tour.onFinish) tour.onFinish({ dismissed: !!dismissed });
    }

    nextBtn.addEventListener('click', () => {
      if (i >= steps.length - 1) return finish(false);
      i++; renderStep();
    });
    prevBtn.addEventListener('click', () => { if (i > 0) { i--; renderStep(); } });
    skipBtn.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey);
    function onKey(e) {
      if (!overlay.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') finish(true);
      if (e.key === 'ArrowRight' || e.key === 'Enter') nextBtn.click();
      if (e.key === 'ArrowLeft') prevBtn.click();
    }
    window.addEventListener('resize', renderStep);
    renderStep();
  }

  // ─────────────────────────────────────────────────────────────
  // COACHMARK — always-on gold dot with popover
  // ─────────────────────────────────────────────────────────────
  const _coachmarkRegistry = new Map();

  function installCoachmarks(defs) {
    // defs = [{ selector, id, title, body, placement? }]
    if (seen('coachmarks_off')) return;

    (defs || []).forEach(def => {
      const els = document.querySelectorAll(def.selector);
      els.forEach((el, idx) => {
        const mid = def.id + (els.length > 1 ? '_' + idx : '');
        if (_coachmarkRegistry.has(mid)) return;
        const dot = document.createElement('button');
        dot.className = 'sb-coachmark';
        dot.type = 'button';
        dot.setAttribute('aria-label', 'Explain ' + (def.title || 'this'));
        dot.innerHTML = '<span class="sb-coachmark-pulse"></span>';
        document.body.appendChild(dot);
        positionDot(dot, el);
        _coachmarkRegistry.set(mid, { dot, el, def });

        dot.addEventListener('click', (e) => {
          e.stopPropagation();
          openCoachmarkPopover(def, el);
        });

        // Track element position (scroll, resize)
        const reposition = () => positionDot(dot, el);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
      });
    });
  }

  function positionDot(dot, el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) { dot.style.display = 'none'; return; }
    dot.style.display = 'block';
    dot.style.top  = (window.scrollY + r.top - 6) + 'px';
    dot.style.left = (window.scrollX + r.right - 8) + 'px';
  }

  function openCoachmarkPopover(def, anchor) {
    // Close any other open
    document.querySelectorAll('.sb-coachmark-pop').forEach(p => p.remove());
    const pop = document.createElement('div');
    pop.className = 'sb-coachmark-pop';
    pop.innerHTML = `
      <div class="sb-coachmark-pop-head">
        <div class="sb-coachmark-pop-kicker">Coachmark</div>
        <button class="sb-coachmark-pop-close" aria-label="Close">×</button>
      </div>
      <div class="sb-coachmark-pop-title">${esc(def.title || '')}</div>
      <div class="sb-coachmark-pop-body">${def.body || ''}</div>
      ${def.learnMore ? `<a class="sb-coachmark-pop-link" href="${esc(def.learnMore)}">Learn more →</a>` : ''}
    `;
    document.body.appendChild(pop);

    const r = anchor.getBoundingClientRect();
    const pw = 340;
    const vw = window.innerWidth;
    let left = r.left + r.width + 20;
    if (left + pw > vw - 20) left = Math.max(20, r.left - pw - 20);
    pop.style.top  = (window.scrollY + r.top) + 'px';
    pop.style.left = (window.scrollX + left) + 'px';

    pop.querySelector('.sb-coachmark-pop-close').addEventListener('click', () => pop.remove());
    // Dismiss on outside click
    setTimeout(() => {
      document.addEventListener('click', function closer(e){
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', closer); }
      });
    }, 50);
  }

  function hideAllCoachmarks() {
    _coachmarkRegistry.forEach(({ dot }) => dot.remove());
    _coachmarkRegistry.clear();
    markSeen('coachmarks_off');
  }

  // ─────────────────────────────────────────────────────────────
  // WALKTHROUGH — animated demo with narration bar
  // ─────────────────────────────────────────────────────────────
  function playWalkthrough(id, opts) {
    opts = opts || {};
    const walks = (window.SB_Tours && window.SB_Tours.walkthroughs) || {};
    const w = walks[id];
    if (!w) { console.warn('[tutorial] unknown walkthrough:', id); return; }

    const modal = document.createElement('div');
    modal.className = 'sb-walk-modal';
    modal.innerHTML = `
      <div class="sb-walk-backdrop"></div>
      <div class="sb-walk-card">
        <div class="sb-walk-head">
          <div class="sb-walk-kicker">Walkthrough · <span class="sb-walk-name">${esc(w.name || '')}</span></div>
          <button class="sb-walk-close" aria-label="Close">×</button>
        </div>
        <div class="sb-walk-stage"></div>
        <div class="sb-walk-narrate">
          <div class="sb-walk-narrate-title"></div>
          <div class="sb-walk-narrate-body"></div>
        </div>
        <div class="sb-walk-foot">
          <div class="sb-walk-progress">
            <div class="sb-walk-progress-bar"></div>
          </div>
          <div class="sb-walk-controls">
            <button class="sb-tut-btn sb-tut-btn-ghost" data-walk="prev">← Back</button>
            <button class="sb-tut-btn sb-tut-btn-ghost" data-walk="pause">Pause</button>
            <button class="sb-tut-btn sb-tut-btn-gold" data-walk="next">Next →</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const stage    = modal.querySelector('.sb-walk-stage');
    const titleEl  = modal.querySelector('.sb-walk-narrate-title');
    const bodyEl   = modal.querySelector('.sb-walk-narrate-body');
    const progBar  = modal.querySelector('.sb-walk-progress-bar');
    const prevBtn  = modal.querySelector('[data-walk="prev"]');
    const pauseBtn = modal.querySelector('[data-walk="pause"]');
    const nextBtn  = modal.querySelector('[data-walk="next"]');

    let i = 0, paused = false, timer = null;
    const steps = w.steps || [];

    function renderStep() {
      const s = steps[i];
      if (!s) return finish();
      titleEl.textContent = s.title || '';
      bodyEl.innerHTML = s.body || '';
      stage.innerHTML = typeof s.stage === 'function' ? s.stage() : (s.stage || '');
      const pct = ((i + 1) / steps.length) * 100;
      progBar.style.width = pct + '%';
      prevBtn.style.visibility = i === 0 ? 'hidden' : 'visible';
      nextBtn.textContent = i === steps.length - 1 ? 'Finish ✓' : 'Next →';

      if (!paused && s.durationMs && i < steps.length - 1) {
        clearTimeout(timer);
        timer = setTimeout(() => { i++; renderStep(); }, s.durationMs);
      }
    }
    function finish() {
      clearTimeout(timer);
      markSeen('walk_' + id);
      modal.remove();
      if (w.onFinish) w.onFinish();
    }

    nextBtn.addEventListener('click', () => {
      clearTimeout(timer);
      if (i >= steps.length - 1) return finish();
      i++; renderStep();
    });
    prevBtn.addEventListener('click', () => { clearTimeout(timer); if (i > 0) { i--; renderStep(); } });
    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Play' : 'Pause';
      if (paused) clearTimeout(timer);
      else renderStep();
    });
    modal.querySelector('.sb-walk-close').addEventListener('click', finish);
    modal.querySelector('.sb-walk-backdrop').addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
    function onKey(e){
      if (!modal.isConnected) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') nextBtn.click();
      if (e.key === 'ArrowLeft') prevBtn.click();
      if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
    }

    renderStep();
  }

  function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  // ─────────────────────────────────────────────────────────────
  // HELP MENU — floating "?" button in corner
  // ─────────────────────────────────────────────────────────────
  function installHelpButton(context) {
    // context = 'home' | 'app' | 'workflow'
    if (document.querySelector('.sb-help-fab')) return;
    const btn = document.createElement('button');
    btn.className = 'sb-help-fab';
    btn.setAttribute('aria-label', 'Help menu');
    btn.innerHTML = '?';
    document.body.appendChild(btn);

    btn.addEventListener('click', () => openHelpMenu(context));
  }

  function openHelpMenu(context) {
    document.querySelectorAll('.sb-help-menu').forEach(m => m.remove());
    const menu = document.createElement('div');
    menu.className = 'sb-help-menu';

    const items = [
      { label: 'Take the tour', action: () => startTour(defaultTourFor(context), { force: true }) },
      { label: 'Play the demo walkthrough', action: () => playWalkthrough('script_to_breakdown', { force: true }) },
      { label: 'Open the docs', action: () => { window.location.href = '/learn/'; } },
      { label: 'Toggle coachmarks', action: () => {
          if (seen('coachmarks_off')) { localStorage.removeItem(LS_PREFIX + 'coachmarks_off'); window.location.reload(); }
          else hideAllCoachmarks();
        }},
      { label: 'Reset tutorial state', action: () => { if (confirm('Reset all tutorial progress?')) { unmarkAll(); window.location.reload(); } } },
    ];

    menu.innerHTML = `
      <div class="sb-help-menu-head">Help</div>
      ${items.map((it, i) => `<button class="sb-help-menu-item" data-i="${i}">${esc(it.label)}</button>`).join('')}
    `;
    document.body.appendChild(menu);
    menu.querySelectorAll('.sb-help-menu-item').forEach((b, idx) => {
      b.addEventListener('click', () => { menu.remove(); items[idx].action(); });
    });
    setTimeout(() => {
      document.addEventListener('click', function closer(e){
        if (!menu.contains(e.target) && !e.target.classList.contains('sb-help-fab')) {
          menu.remove(); document.removeEventListener('click', closer);
        }
      });
    }, 50);
  }

  function defaultTourFor(context) {
    return context === 'app' ? 'app_onboarding'
         : context === 'workflow' ? 'workflow_dropin'
         : 'home_intro';
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────
  window.SB_Tutorial = {
    startTour,
    installCoachmarks,
    playWalkthrough,
    installHelpButton,
    openHelpMenu,
    seen,
    markSeen,
    reset: () => { unmarkAll(); window.location.reload(); },
    _esc: esc,
  };
})();
