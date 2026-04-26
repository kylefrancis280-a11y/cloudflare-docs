/**
 * SHOTBREAK — TIMELINE ENGINE
 * =============================================================
 * All editor logic. Paired with editor/index.html.
 *
 * Data model:
 *   BinClip    { id, name, src, duration, thumb, kind: 'video'|'audio' }
 *   ClipInst   { id, binClipId, track: 'V1'|'A1', start, sourceIn, sourceOut,
 *                transitionIn: { type, duration } }
 *   The timeline is ordered by { track, start }. Clips on the same track never overlap
 *   except inside a transition zone (handled at playback time).
 * =============================================================
 */

(function () {
  'use strict';

  // ---------- State ----------
  const state = {
    bin: [],                // BinClip[]
    timeline: [],           // ClipInst[]
    pxPerSec: 80,           // zoom
    playhead: 0,            // seconds
    playing: false,
    selectedClipId: null,
    // Preview engine
    activeVideo: 'A',       // which <video> is currently primary
    playTimer: null,
  };

  let nextId = 1;
  const uid = (p = 'c') => `${p}_${nextId++}_${Date.now().toString(36)}`;

  // ---------- DOM refs ----------
  const $ = id => document.getElementById(id);
  const previewWrap = $('preview');
  const previewA = $('previewA');
  const previewB = $('previewB');
  const previewPlaceholder = $('preview-placeholder');
  const laneV1 = $('lane-v1');
  const laneA1 = $('lane-a1');
  const rulerInner = $('ruler-inner');
  const ruler = $('ruler');
  const tracksScroll = $('tracks-scroll');
  const playhead = $('playhead');
  const timecode = $('timecode');
  const totalDuration = $('total-duration');
  const zoomSlider = $('zoom-slider');
  const inspectorEl = $('inspector');
  const agentLog = $('agent-log');

  // ---------- Utilities ----------
  function formatTC(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const cs = Math.floor((s % 1) * 100);
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(cs)}`;
  }
  function secToPx(s) { return s * state.pxPerSec; }
  function pxToSec(p) { return p / state.pxPerSec; }
  function binClipOf(inst) { return state.bin.find(b => b.id === inst.binClipId); }
  function timelineDuration() {
    if (!state.timeline.length) return 0;
    return Math.max(...state.timeline.map(c => c.start + (c.sourceOut - c.sourceIn)));
  }
  function logAgent(msg, kind = 'info') {
    const line = document.createElement('div');
    line.className = 'line ' + kind;
    line.textContent = `› ${msg}`;
    agentLog.appendChild(line);
    agentLog.scrollTop = agentLog.scrollHeight;
  }

  // ---------- Rendering ----------

  function renderRuler() {
    const dur = Math.max(timelineDuration() + 10, 30);
    const width = secToPx(dur);
    rulerInner.style.width = width + 'px';
    rulerInner.innerHTML = '';
    // Pick tick interval based on zoom: show a labeled tick every ~80px.
    const labelEvery = Math.max(1, Math.round(80 / state.pxPerSec));
    for (let s = 0; s <= dur; s++) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = secToPx(s) + 'px';
      rulerInner.appendChild(tick);
      if (s % labelEvery === 0) {
        const label = document.createElement('div');
        label.className = 'ruler-label';
        label.style.left = secToPx(s) + 'px';
        label.textContent = formatTC(s).slice(3); // drop HH
        rulerInner.appendChild(label);
      }
    }
    const tracksInner = $('tracks-inner');
    tracksInner.style.width = width + 'px';
    totalDuration.textContent = '/ ' + formatTC(timelineDuration());
  }

  function renderBin() {
    const binEl = $('bin-items');
    binEl.innerHTML = '';
    state.bin.forEach(bc => {
      const el = document.createElement('div');
      el.className = 'bin-item';
      el.draggable = true;
      el.dataset.binId = bc.id;
      el.innerHTML = `
        ${bc.thumb ? `<img class="thumb" src="${bc.thumb}" alt="" />` : `<div class="thumb"></div>`}
        <div class="meta">
          <div class="name">${bc.name}</div>
          <div class="dur">${formatTC(bc.duration)} · ${bc.kind}</div>
        </div>`;
      el.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/bin-id', bc.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      binEl.appendChild(el);
    });
  }

  function renderTimeline() {
    // Clear lanes
    laneV1.querySelectorAll('.clip').forEach(n => n.remove());
    laneA1.querySelectorAll('.clip').forEach(n => n.remove());

    state.timeline.forEach(inst => {
      const bc = binClipOf(inst);
      if (!bc) return;
      const lane = inst.track === 'V1' ? laneV1 : laneA1;
      const el = document.createElement('div');
      el.className = 'clip' + (inst.id === state.selectedClipId ? ' selected' : '');
      el.dataset.clipId = inst.id;
      const left = secToPx(inst.start);
      const width = secToPx(inst.sourceOut - inst.sourceIn);
      el.style.left = left + 'px';
      el.style.width = width + 'px';

      el.innerHTML = `
        ${bc.thumb && inst.track === 'V1' ? `<img class="clip-thumb" src="${bc.thumb}" alt="" />` : ''}
        <div class="clip-name">${bc.name}</div>
        <div class="clip-dur">${formatTC(inst.sourceOut - inst.sourceIn)}</div>
        <div class="handle left" data-edge="left"></div>
        <div class="handle right" data-edge="right"></div>
        ${inst.transitionIn && inst.transitionIn.type !== 'hard_cut'
          ? `<div class="transition-marker ${inst.transitionIn.type}"></div>` : ''}
      `;
      lane.appendChild(el);
      attachClipInteractions(el, inst);
    });
  }

  function renderPlayhead() {
    const px = secToPx(state.playhead) + 60; // +60 for track-label offset
    playhead.style.left = px + 'px';
    timecode.textContent = formatTC(state.playhead);
  }

  function renderInspector() {
    if (!state.selectedClipId) {
      inspectorEl.innerHTML = `<h3>Inspector</h3><div class="inspector-empty">Select a clip to edit its properties.</div>`;
      return;
    }
    const inst = state.timeline.find(c => c.id === state.selectedClipId);
    if (!inst) return;
    const bc = binClipOf(inst);
    const clipDur = (inst.sourceOut - inst.sourceIn).toFixed(2);
    const srcDur = bc.duration.toFixed(2);

    inspectorEl.innerHTML = `
      <h3>${bc.name}</h3>
      <div class="field">
        <label>Source Duration</label>
        <input type="text" readonly value="${srcDur}s" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>Trim In (s)</label>
          <input type="number" id="insp-src-in" step="0.05" min="0" max="${bc.duration}" value="${inst.sourceIn.toFixed(2)}" />
        </div>
        <div class="field">
          <label>Trim Out (s)</label>
          <input type="number" id="insp-src-out" step="0.05" min="0" max="${bc.duration}" value="${inst.sourceOut.toFixed(2)}" />
        </div>
      </div>
      <div class="field">
        <label>Start on Timeline (s)</label>
        <input type="number" id="insp-start" step="0.05" min="0" value="${inst.start.toFixed(2)}" />
      </div>
      <div class="field">
        <label>Clip Length</label>
        <input type="text" readonly value="${clipDur}s" />
      </div>
      <div class="field">
        <label>Transition In</label>
        <select id="insp-trans-type">
          <option value="hard_cut" ${inst.transitionIn.type === 'hard_cut' ? 'selected' : ''}>Hard Cut</option>
          <option value="dissolve" ${inst.transitionIn.type === 'dissolve' ? 'selected' : ''}>Dissolve</option>
          <option value="fade"     ${inst.transitionIn.type === 'fade' ? 'selected' : ''}>Fade from Black</option>
          <option value="match_cut"${inst.transitionIn.type === 'match_cut' ? 'selected' : ''}>Match Cut</option>
          <option value="j_cut"    ${inst.transitionIn.type === 'j_cut' ? 'selected' : ''}>J-Cut (audio leads)</option>
          <option value="l_cut"    ${inst.transitionIn.type === 'l_cut' ? 'selected' : ''}>L-Cut (audio trails)</option>
        </select>
      </div>
      <div class="field">
        <label>Transition Duration (s)</label>
        <input type="number" id="insp-trans-dur" step="0.1" min="0" max="3" value="${(inst.transitionIn.duration || 0).toFixed(1)}" />
      </div>
      <div class="btn-row">
        <button id="insp-split">Split at playhead</button>
        <button id="insp-duplicate">Duplicate</button>
        <button class="danger" id="insp-delete">Delete</button>
      </div>
    `;

    // Wire inspector inputs
    $('insp-src-in').addEventListener('change', e => {
      const v = Math.max(0, Math.min(parseFloat(e.target.value), inst.sourceOut - 0.1));
      inst.sourceIn = v;
      renderAll();
    });
    $('insp-src-out').addEventListener('change', e => {
      const v = Math.min(bc.duration, Math.max(parseFloat(e.target.value), inst.sourceIn + 0.1));
      inst.sourceOut = v;
      renderAll();
    });
    $('insp-start').addEventListener('change', e => {
      inst.start = Math.max(0, parseFloat(e.target.value));
      renderAll();
    });
    $('insp-trans-type').addEventListener('change', e => {
      inst.transitionIn.type = e.target.value;
      if (e.target.value === 'hard_cut') inst.transitionIn.duration = 0;
      else if (!inst.transitionIn.duration) inst.transitionIn.duration = 0.5;
      renderAll();
    });
    $('insp-trans-dur').addEventListener('change', e => {
      inst.transitionIn.duration = Math.max(0, Math.min(3, parseFloat(e.target.value)));
      renderAll();
    });
    $('insp-split').addEventListener('click', splitAtPlayhead);
    $('insp-duplicate').addEventListener('click', () => duplicateSelected());
    $('insp-delete').addEventListener('click', () => deleteSelected());
  }

  function renderAll() {
    renderRuler();
    renderTimeline();
    renderPlayhead();
    renderInspector();
    previewPlaceholder.style.display = state.timeline.length ? 'none' : 'block';
  }

  // ---------- Clip interactions (drag, trim) ----------

  function attachClipInteractions(el, inst) {
    // Select on mousedown
    el.addEventListener('mousedown', e => {
      if (e.target.classList.contains('handle')) return;
      state.selectedClipId = inst.id;
      renderAll();
    });

    // Drag to reorder
    let dragMode = null;     // 'move' | 'trim-l' | 'trim-r'
    let startX = 0, startStart = 0, startIn = 0, startOut = 0;

    const onDown = e => {
      e.preventDefault();
      startX = e.clientX;
      startStart = inst.start;
      startIn = inst.sourceIn;
      startOut = inst.sourceOut;
      if (e.target.dataset.edge === 'left') dragMode = 'trim-l';
      else if (e.target.dataset.edge === 'right') dragMode = 'trim-r';
      else dragMode = 'move';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    };
    const onMove = e => {
      const dx = e.clientX - startX;
      const dSec = pxToSec(dx);
      const bc = binClipOf(inst);
      if (dragMode === 'move') {
        inst.start = Math.max(0, startStart + dSec);
      } else if (dragMode === 'trim-l') {
        // Trim from the left: adjust sourceIn AND start so the rest of the clip stays put
        const newIn = Math.max(0, Math.min(startIn + dSec, startOut - 0.1));
        const delta = newIn - startIn;
        inst.sourceIn = newIn;
        inst.start = Math.max(0, startStart + delta);
      } else if (dragMode === 'trim-r') {
        inst.sourceOut = Math.max(startIn + 0.1, Math.min(startOut + dSec, bc.duration));
      }
      renderAll();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragMode = null;
    };
    el.querySelector('.handle.left')?.addEventListener('mousedown', onDown);
    el.querySelector('.handle.right')?.addEventListener('mousedown', onDown);
    el.addEventListener('mousedown', e => {
      if (!e.target.classList.contains('handle')) onDown(e);
    });
  }

  // ---------- Drop target: bin → timeline ----------

  function handleLaneDrop(lane, e) {
    e.preventDefault();
    const binId = e.dataTransfer.getData('text/bin-id');
    if (!binId) return;
    const bc = state.bin.find(b => b.id === binId);
    if (!bc) return;

    const rect = lane.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const dropSec = Math.max(0, pxToSec(x));

    const trackId = lane.dataset.track;
    // Avoid overlap: if a clip exists at dropSec on this track, snap to the nearest gap.
    const adjusted = findFreeStart(trackId, dropSec, bc.duration);

    const inst = {
      id: uid('ci'),
      binClipId: bc.id,
      track: trackId,
      start: adjusted,
      sourceIn: 0,
      sourceOut: bc.duration,
      transitionIn: { type: 'hard_cut', duration: 0 },
    };
    state.timeline.push(inst);
    state.selectedClipId = inst.id;
    renderAll();
  }

  function findFreeStart(track, desired, length) {
    const onTrack = state.timeline.filter(c => c.track === track).sort((a, b) => a.start - b.start);
    for (const c of onTrack) {
      const cDur = c.sourceOut - c.sourceIn;
      if (desired + length <= c.start) break;
      if (desired >= c.start && desired < c.start + cDur) desired = c.start + cDur + 0.01;
    }
    return desired;
  }

  [laneV1, laneA1].forEach(lane => {
    lane.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    lane.addEventListener('drop', e => handleLaneDrop(lane, e));
  });

  // ---------- Split / delete / duplicate ----------

  function splitAtPlayhead() {
    const inst = state.timeline.find(c => c.id === state.selectedClipId);
    if (!inst) return;
    const clipDur = inst.sourceOut - inst.sourceIn;
    const rel = state.playhead - inst.start;
    if (rel <= 0.05 || rel >= clipDur - 0.05) {
      logAgent('Split failed: playhead not inside selected clip.', 'err');
      return;
    }
    const splitPoint = inst.sourceIn + rel;
    const right = {
      ...inst,
      id: uid('ci'),
      start: inst.start + rel,
      sourceIn: splitPoint,
      transitionIn: { type: 'hard_cut', duration: 0 },
    };
    inst.sourceOut = splitPoint;
    state.timeline.push(right);
    renderAll();
  }

  function deleteSelected() {
    state.timeline = state.timeline.filter(c => c.id !== state.selectedClipId);
    state.selectedClipId = null;
    renderAll();
  }
  function duplicateSelected() {
    const inst = state.timeline.find(c => c.id === state.selectedClipId);
    if (!inst) return;
    const cDur = inst.sourceOut - inst.sourceIn;
    const newStart = findFreeStart(inst.track, inst.start + cDur, cDur);
    const copy = { ...inst, id: uid('ci'), start: newStart, transitionIn: { ...inst.transitionIn } };
    state.timeline.push(copy);
    state.selectedClipId = copy.id;
    renderAll();
  }

  // ---------- Playback engine ----------

  // Find the active video clip at a given timeline second. Ignores audio track.
  function videoClipAt(sec) {
    return state.timeline.find(c =>
      c.track === 'V1' && sec >= c.start && sec < c.start + (c.sourceOut - c.sourceIn)
    );
  }
  function audioClipAt(sec) {
    return state.timeline.find(c =>
      c.track === 'A1' && sec >= c.start && sec < c.start + (c.sourceOut - c.sourceIn)
    );
  }

  // Load a clip into a given <video> element, seeking to the right source frame.
  function loadIntoPreview(videoEl, inst, timelineSec) {
    if (!inst) {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.load();
      return;
    }
    const bc = binClipOf(inst);
    if (!bc) return;
    if (videoEl.dataset.clipId !== inst.id) {
      videoEl.dataset.clipId = inst.id;
      videoEl.src = bc.src;
    }
    const relSec = (timelineSec - inst.start) + inst.sourceIn;
    if (Math.abs(videoEl.currentTime - relSec) > 0.1) videoEl.currentTime = relSec;
  }

  function seekPreview() {
    const sec = state.playhead;
    const vClip = videoClipAt(sec);
    const aClip = audioClipAt(sec);
    loadIntoPreview(previewA, vClip, sec);

    // Handle crossfade into the next clip
    if (vClip && vClip.transitionIn?.type === 'dissolve' && vClip.transitionIn.duration > 0) {
      const fadeIn = vClip.start;
      const fadeEnd = fadeIn + vClip.transitionIn.duration;
      if (sec >= fadeIn && sec < fadeEnd) {
        // Blend with previous clip
        const prev = state.timeline
          .filter(c => c.track === 'V1' && c.start + (c.sourceOut - c.sourceIn) >= fadeIn)
          .filter(c => c.id !== vClip.id)
          .sort((a, b) => b.start - a.start)[0];
        if (prev) {
          loadIntoPreview(previewB, prev, Math.min(prev.start + (prev.sourceOut - prev.sourceIn) - 0.01, sec));
          const t = (sec - fadeIn) / vClip.transitionIn.duration;
          previewA.style.opacity = t;
          previewB.style.opacity = 1 - t;
          return;
        }
      }
    }
    // Fade from black
    if (vClip && vClip.transitionIn?.type === 'fade' && vClip.transitionIn.duration > 0) {
      const fadeEnd = vClip.start + vClip.transitionIn.duration;
      if (sec < fadeEnd) {
        const t = Math.max(0, (sec - vClip.start) / vClip.transitionIn.duration);
        previewA.style.opacity = t;
        previewB.style.opacity = 0;
        return;
      }
    }
    previewA.style.opacity = 1;
    previewB.style.opacity = 0;

    // Audio: if the active video clip has no native audio usable or there's a separate A1 clip,
    // play A1 on previewB. Keep simple: previewB becomes an audio source if aClip differs from vClip.
    if (aClip && (!vClip || binClipOf(aClip).id !== binClipOf(vClip).id)) {
      if (previewB.dataset.clipId !== aClip.id) {
        previewB.dataset.clipId = aClip.id;
        previewB.src = binClipOf(aClip).src;
        previewB.muted = false;
      }
      const relSec = (sec - aClip.start) + aClip.sourceIn;
      if (Math.abs(previewB.currentTime - relSec) > 0.1) previewB.currentTime = relSec;
    }
  }

  function togglePlay() {
    if (state.playing) {
      state.playing = false;
      previewA.pause(); previewB.pause();
      clearInterval(state.playTimer);
      $('btn-play').textContent = '▶';
    } else {
      if (!state.timeline.length) return;
      state.playing = true;
      $('btn-play').textContent = '⏸';
      const total = timelineDuration();
      if (state.playhead >= total) state.playhead = 0;
      seekPreview();
      previewA.play().catch(() => {});
      const tickStart = performance.now();
      const startSec = state.playhead;
      state.playTimer = setInterval(() => {
        const elapsed = (performance.now() - tickStart) / 1000;
        state.playhead = startSec + elapsed;
        if (state.playhead >= total) {
          state.playhead = total;
          togglePlay();
          return;
        }
        seekPreview();
        renderPlayhead();
      }, 33);
    }
  }

  // ---------- Ruler / scrub ----------

  ruler.addEventListener('click', e => {
    const rect = ruler.getBoundingClientRect();
    const x = e.clientX - rect.left;
    state.playhead = Math.max(0, pxToSec(x));
    seekPreview();
    renderPlayhead();
  });

  // ---------- Header buttons ----------

  $('btn-save').addEventListener('click', () => {
    const payload = { project: $('project-name').value, bin: state.bin, timeline: state.timeline, savedAt: Date.now() };
    localStorage.setItem('shotbreak_editor_' + payload.project, JSON.stringify(payload));
    logAgent(`Project saved locally: ${payload.project}`, 'ok');
  });

  $('btn-load').addEventListener('click', () => {
    const PREFIX = 'shotbreak_editor_';
    const names = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) names.push(k.slice(PREFIX.length));
    }
    if (names.length === 0) { logAgent('No saved projects found.', 'err'); return; }
    names.sort();
    const choice = window.prompt(`Saved projects:\n  ${names.join('\n  ')}\n\nType the project name to load:`, names[0]);
    if (!choice) return;
    const raw = localStorage.getItem(PREFIX + choice);
    if (!raw) { logAgent(`Not found: ${choice}`, 'err'); return; }
    let payload;
    try { payload = JSON.parse(raw); }
    catch (e) { logAgent(`Corrupt save: ${e.message}`, 'err'); return; }
    state.bin = Array.isArray(payload.bin) ? payload.bin : [];
    state.timeline = Array.isArray(payload.timeline) ? payload.timeline : [];
    state.selectedClipId = null;
    state.playhead = 0;
    $('project-name').value = payload.project || choice;
    renderAll();
    logAgent(`Loaded project: ${choice} (${state.bin.length} clips, ${state.timeline.length} on timeline)`, 'ok');
  });

  $('btn-export').addEventListener('click', () => {
    const edl = exportEDL();
    const blob = new Blob([JSON.stringify(edl, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${$('project-name').value.replace(/\s+/g, '_')}.edl.json`;
    a.click();
    URL.revokeObjectURL(url);
    logAgent('EDL exported.', 'ok');
  });

  // ---------- Render (ffmpeg.wasm, client-side) ----------
  // Uses the same self-hosted ffmpeg-core bundle that powers the Media Hub
  // stitch feature — already cached for most users, no extra 30MB download.
  // v1: hard-cut render only. Respects per-clip source_in/source_out trims.
  // Transitions are rendered as hard cuts in v1; they still appear in the EDL.

  let _ffmpegInstance = null;
  async function loadFFmpeg(progressCb) {
    if (_ffmpegInstance && _ffmpegInstance.loaded) return _ffmpegInstance;
    progressCb && progressCb('Loading FFmpeg core (30MB, one-time)...');
    const BASE = '/static/ffmpeg';
    async function loadScript(url) {
      await new Promise((ok, fail) => {
        const s = document.createElement('script');
        s.src = url; s.onload = ok; s.onerror = () => fail(new Error('Failed: ' + url));
        document.head.appendChild(s);
      });
    }
    if (!window.FFmpegWASM) {
      await loadScript(BASE + '/ffmpeg.js');
      await loadScript(BASE + '/index.js');
    }
    const { FFmpeg } = window.FFmpegWASM || {};
    if (!FFmpeg) throw new Error('FFmpeg class not available after script load');
    const ff = new FFmpeg();
    ff.on('log', ({ message }) => { if (message) console.log('[ffmpeg]', message); });
    ff.on('progress', ({ progress }) => {
      progressCb && progressCb(`Rendering... ${Math.round(progress * 100)}%`);
    });
    progressCb && progressCb('Starting FFmpeg worker (first run may take 30s)...');
    await ff.load({
      coreURL: BASE + '/ffmpeg-core.js',
      wasmURL: BASE + '/ffmpeg-core.wasm',
    });
    _ffmpegInstance = ff;
    return ff;
  }

  async function fetchToU8(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Fetch failed: ' + url + ' (' + r.status + ')');
    return new Uint8Array(await r.arrayBuffer());
  }

  async function renderTimelineToMP4(progressCb) {
    const sorted = state.timeline
      .filter(c => c.track === 'V1')
      .slice()
      .sort((a, b) => a.start - b.start);
    if (!sorted.length) throw new Error('Timeline is empty. Add clips before rendering.');

    const ff = await loadFFmpeg(progressCb);

    // Cleanup any prior session files
    try {
      const ls = await ff.listDir('/');
      for (const e of ls) {
        if (e.name.startsWith('src_') || e.name.startsWith('trim_') || e.name === 'list.txt' || e.name.startsWith('out_')) {
          await ff.deleteFile('/' + e.name).catch(() => {});
        }
      }
    } catch (_) {}

    // Download each unique source clip once, reuse for multiple trims.
    const uniqueSrcs = [...new Set(sorted.map(c => {
      const bin = state.bin.find(b => b.id === c.binClipId);
      return bin && bin.src;
    }).filter(Boolean))];

    const srcFiles = {};
    for (let i = 0; i < uniqueSrcs.length; i++) {
      progressCb && progressCb(`Downloading source ${i + 1}/${uniqueSrcs.length}...`);
      const u8 = await fetchToU8(uniqueSrcs[i]);
      const name = 'src_' + i + '.mp4';
      await ff.writeFile(name, u8);
      srcFiles[uniqueSrcs[i]] = name;
    }

    // Trim each timeline clip to its [sourceIn, sourceOut] range.
    progressCb && progressCb('Trimming clips...');
    const trimmedFiles = [];
    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const bin = state.bin.find(b => b.id === c.binClipId);
      if (!bin) continue;
      const srcName = srcFiles[bin.src];
      if (!srcName) continue;
      const trimName = 'trim_' + String(i).padStart(3, '0') + '.mp4';
      const inPt  = Math.max(0, c.sourceIn || 0);
      const outPt = c.sourceOut != null ? c.sourceOut : (bin.duration || inPt + 5);
      const dur   = Math.max(0.1, outPt - inPt);
      // Re-encode on trim so all segments have compatible streams for concat.
      await ff.exec([
        '-ss', String(inPt),
        '-i', srcName,
        '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        trimName,
      ]);
      trimmedFiles.push(trimName);
    }

    if (!trimmedFiles.length) throw new Error('Nothing to render — bin/timeline mismatch?');

    // Concat all trimmed segments.
    progressCb && progressCb('Stitching final output...');
    const list = trimmedFiles.map(f => "file '" + f + "'").join('\n');
    await ff.writeFile('list.txt', new TextEncoder().encode(list));
    const outName = 'out_' + Date.now() + '.mp4';
    await ff.exec([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-c', 'copy',  // streams are now compatible from trim pass; copy is safe and fast
      '-movflags', '+faststart',
      outName,
    ]);

    const data = await ff.readFile(outName);
    // Cleanup
    for (const f of trimmedFiles) await ff.deleteFile(f).catch(() => {});
    for (const name of Object.values(srcFiles)) await ff.deleteFile(name).catch(() => {});
    await ff.deleteFile('list.txt').catch(() => {});
    await ff.deleteFile(outName).catch(() => {});

    return new Blob([data.buffer], { type: 'video/mp4' });
  }

  $('btn-render').addEventListener('click', async () => {
    const btn = $('btn-render');
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      const blob = await renderTimelineToMP4(msg => {
        btn.textContent = msg.length > 28 ? msg.slice(0, 28) + '...' : msg;
        logAgent(msg, 'info');
      });
      const url = URL.createObjectURL(blob);
      const filename = ($('project-name').value || 'shotbreak_render').replace(/[^a-z0-9_\-]/gi, '_') + '.mp4';
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      logAgent(`Render complete: ${filename} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`, 'ok');
    } catch (e) {
      console.error('[render]', e);
      logAgent('Render failed: ' + e.message, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  function exportEDL() {
    return {
      version: 1,
      project: $('project-name').value,
      total_duration_seconds: timelineDuration(),
      bin: state.bin.map(b => ({ id: b.id, name: b.name, src: b.src, duration: b.duration, kind: b.kind })),
      timeline: state.timeline.map(c => ({
        id: c.id, bin_clip_id: c.binClipId, track: c.track,
        start: c.start, source_in: c.sourceIn, source_out: c.sourceOut,
        transition_in: c.transitionIn,
      })).sort((a, b) => (a.track + a.start).localeCompare(b.track + b.start)),
    };
  }

  // ---------- Transport ----------

  $('btn-play').addEventListener('click', togglePlay);
  $('btn-back').addEventListener('click', () => { state.playhead = Math.max(0, state.playhead - 1); seekPreview(); renderPlayhead(); });
  $('btn-fwd').addEventListener('click', () => { state.playhead = Math.min(timelineDuration(), state.playhead + 1); seekPreview(); renderPlayhead(); });
  $('btn-split').addEventListener('click', splitAtPlayhead);

  // Zoom
  zoomSlider.addEventListener('input', e => {
    state.pxPerSec = parseFloat(e.target.value);
    renderAll();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); splitAtPlayhead(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
    else if (e.key === 'd' || e.key === 'D') { e.preventDefault(); duplicateSelected(); }
  });

  // ---------- Upload / load ----------

  $('btn-upload').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      await addFileToBin(f);
    }
    renderBin();
  });

  async function addFileToBin(file) {
    const url = URL.createObjectURL(file);
    const kind = file.type.startsWith('audio/') ? 'audio' : 'video';
    // Get duration + thumbnail
    const duration = await new Promise((resolve) => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.src = url;
      probe.onloadedmetadata = () => resolve(probe.duration || 0);
      probe.onerror = () => resolve(0);
    });
    // Generate thumbnail for video
    let thumb = null;
    if (kind === 'video') {
      thumb = await generateThumbnail(url);
    }
    state.bin.push({ id: uid('b'), name: file.name, src: url, duration, thumb, kind });
  }

  async function generateThumbnail(src) {
    return new Promise(resolve => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true; v.playsInline = true;
      v.src = src;
      v.onloadeddata = () => {
        try { v.currentTime = Math.min(1, v.duration / 3); } catch { resolve(null); }
      };
      v.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      v.onerror = () => resolve(null);
    });
  }

  // Load previously generated SHOTBREAK clips.
  // Source of truth: localStorage key 'SB_Generated' (written by app.html's
  // WaveSpeed completion handlers). Falls back to window.SB_Generated if
  // the editor is embedded in the same page as app.html.
  function readGeneratedStore() {
    try {
      const raw = localStorage.getItem('SB_Generated');
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) return arr;
      }
    } catch (_) {}
    if (Array.isArray(window.SB_Generated)) return window.SB_Generated;
    if (typeof window.SB_Generated === 'function') return window.SB_Generated();
    return [];
  }

  $('btn-load-generated').addEventListener('click', async () => {
    logAgent('Loading generated clips from SHOTBREAK...', 'info');
    let generated = [];
    try { generated = await readGeneratedStore(); }
    catch (e) { logAgent('Could not read store: ' + e.message, 'err'); return; }

    // De-dupe against what's already in the bin (by src URL).
    const existingSrcs = new Set(state.bin.map(c => c.src));
    let added = 0;
    for (const g of generated) {
      const src = g.src || g.url || g.videoUrl;
      if (!src || existingSrcs.has(src)) continue;
      state.bin.push({
        id: uid('b'),
        name: g.name || 'Generated clip',
        src,
        duration: g.duration || 0,
        thumb: g.thumb || null,
        kind: 'video',
      });
      added++;
    }
    renderBin();
    logAgent(`Loaded ${added} new clip(s) (total in bin: ${state.bin.length}).`, 'ok');
  });

  // Auto-pull on load too, so users don't have to click if they just came
  // from a generation session.
  setTimeout(() => {
    const generated = (() => { try { return readGeneratedStore(); } catch { return []; } })();
    if (!generated || !generated.length) return;
    const existingSrcs = new Set(state.bin.map(c => c.src));
    let added = 0;
    for (const g of generated) {
      const src = g.src || g.url || g.videoUrl;
      if (!src || existingSrcs.has(src)) continue;
      state.bin.push({
        id: uid('b'),
        name: g.name || 'Generated clip',
        src,
        duration: g.duration || 0,
        thumb: g.thumb || null,
        kind: 'video',
      });
      added++;
    }
    if (added) { renderBin(); logAgent(`Auto-loaded ${added} clip(s) from recent generations.`, 'ok'); }
  }, 300);

  // ---------- Agent integrations ----------

  function agentsAvailable() {
    if (!window.SB_Agents) { logAgent('SB_Agents client not loaded.', 'err'); return false; }
    return true;
  }

  $('agent-auteur').addEventListener('click', () => {
    if (!agentsAvailable()) return;
    $('modal-auteur').classList.add('show');
  });

  window.closeModal = id => $(id).classList.remove('show');
  window.submitAuteur = async () => {
    const text = $('auteur-input').value.trim();
    if (!text) return;
    closeModal('modal-auteur');
    logAgent('THE AUTEUR is planning...', 'info');
    try {
      const r = await window.SB_Agents.auteurPlan(text);
      const plan = r.result?.plan || r.result;
      logAgent(`AUTEUR vision: ${plan?.vision_statement || '(see console)'}`, 'ok');
      console.log('[AUTEUR PLAN]', plan);
      if (plan?.agent_plan) {
        logAgent(`Recommended chain: ${plan.agent_plan.map(a => a.agent_id).join(' → ')}`, 'info');
      }
    } catch (e) {
      logAgent(`Auteur failed: ${e.message}`, 'err');
    }
  };

  $('agent-showrunner').addEventListener('click', async () => {
    if (!agentsAvailable()) return;
    if (!state.timeline.length) { logAgent('Timeline is empty. Add clips first.', 'err'); return; }
    logAgent('THE SHOWRUNNER is reviewing the cut...', 'info');
    try {
      const r = await window.SB_Agents.showrunnerCut({
        timeline: exportEDL(),
        request: 'Audit continuity and propose a recommended cut.',
      });
      const cut = r.result?.cut || r.result;
      console.log('[SHOWRUNNER CUT]', cut);
      logAgent(`Verdict: ${cut?.sign_off || '(see console)'}`, 'ok');
      if (cut?.recommended_cut?.length) {
        logAgent('Apply recommended cut? Type yes in console: SBApplyCut()', 'info');
        window.SBApplyCut = () => applyRecommendedCut(cut.recommended_cut);
      }
      (cut?.continuity_issues || []).forEach(iss => {
        logAgent(`[${iss.severity}] ${iss.issue} — fix: ${iss.fix}`, iss.severity === 'critical' ? 'err' : 'info');
      });
    } catch (e) {
      logAgent(`Showrunner failed: ${e.message}`, 'err');
    }
  });

  function applyRecommendedCut(recommended) {
    // Map by shot_id → binClipId. If the Showrunner references shot IDs that don't match
    // bin clip IDs, fall back to ordinal mapping.
    const newTimeline = [];
    let cursor = 0;
    recommended.forEach((r, i) => {
      const match = state.bin.find(b => b.id === r.shot_id || b.name === r.shot_id) || state.bin[i];
      if (!match) return;
      const dur = (r.trim_out - r.trim_in);
      newTimeline.push({
        id: uid('ci'),
        binClipId: match.id,
        track: 'V1',
        start: cursor,
        sourceIn: r.trim_in,
        sourceOut: r.trim_out,
        transitionIn: { type: r.transition_in || 'hard_cut', duration: r.transition_duration || 0 },
      });
      cursor += dur;
    });
    state.timeline = newTimeline;
    renderAll();
    logAgent(`Applied recommended cut (${newTimeline.length} clips).`, 'ok');
  }

  async function runSingleAgent(agentId, label) {
    if (!agentsAvailable()) return;
    logAgent(`${label} running...`, 'info');
    try {
      const r = await window.SB_Agents.invoke(agentId, {
        timeline: exportEDL(),
        instruction: `Review and report.`,
      });
      console.log(`[${agentId.toUpperCase()}]`, r.output);
      logAgent(`${label} complete. See console for full output.`, 'ok');
    } catch (e) {
      logAgent(`${label} failed: ${e.message}`, 'err');
    }
  }

  $('agent-pacing').addEventListener('click', () => runSingleAgent('pacing-doctor', 'Pacing Doctor'));
  $('agent-continuity').addEventListener('click', () => runSingleAgent('continuity-supervisor', 'Continuity Supervisor'));
  $('agent-polish').addEventListener('click', () => runSingleAgent('polish-pass', 'Polish Pass'));

  // ---------- Boot ----------

  renderAll();
  logAgent('Editor ready.', 'ok');

})();
