/* Scroll-linked scenery. No scroll interception, animation library or idle loop. */
(function (global) {
  'use strict';

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smooth = t => t * t * (3 - 2 * t);
  const mix = (a, b, t) => a + (b - a) * t;
  const HERO = Object.freeze({ scene: 'hero', scale: 1.025, x: 0, y: 0, shade: 0.12 });

  // Each incoming chapter fades over roughly half a viewport. Layout is measured
  // separately; expanding a table or loading a font never leaves stale offsets.
  function buildTimeline(markers, viewport, maxScroll) {
    viewport = Math.max(1, viewport);
    maxScroll = Math.max(0, maxScroll);
    const stops = [{ ...HERO, at: 0 }];
    for (const marker of markers) {
      const previous = stops[stops.length - 1];
      const end = clamp(marker.top - viewport * 0.24, 0, maxScroll);
      if (end <= previous.at + 1) continue;
      const start = Math.max(previous.at, end - viewport * 0.5);
      if (start > previous.at + 1) {
        stops.push({ ...previous, at: start,
          scale: Math.min(1.13, previous.scale + 0.025), y: previous.y - 0.25 });
      }
      stops.push({ ...marker, at: end });
    }
    const last = stops[stops.length - 1];
    if (maxScroll > last.at + 1) {
      stops.push({ ...last, at: maxScroll, scale: Math.min(1.13, last.scale + 0.018), y: last.y - 0.3 });
    }
    return stops;
  }

  function sampleTimeline(stops, scrollTop, options = {}) {
    if (!stops.length) stops = [{ ...HERO, at: 0 }];
    const y = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
    let a = stops[0], b = a;
    for (let i = 1; i < stops.length; i++) {
      b = stops[i];
      if (y <= b.at) break;
      a = b;
    }
    const t = b.at === a.at ? 0 : smooth(clamp((y - a.at) / (b.at - a.at), 0, 1));
    const dominant = t < 0.5 ? a : b;
    if (options.reduced) {
      return { from: dominant.scene, to: dominant.scene, blend: 0,
        scale: 1.025, x: 0, y: 0, shade: dominant.shade };
    }
    return {
      from: a.scene, to: b.scene, blend: a.scene === b.scene ? 0 : t,
      scale: options.compact ? 1.035 : mix(a.scale, b.scale, t),
      x: options.compact ? 0 : mix(a.x, b.x, t),
      y: options.compact ? 0 : mix(a.y, b.y, t),
      shade: mix(a.shade, b.shade, t)
    };
  }

  function resolveReadyFrame(frame, ready, previous = 'hero') {
    if (ready[frame.from] && ready[frame.to]) return frame;
    const fallback = ready[frame.from] ? frame.from : ready[frame.to] ? frame.to
      : ready[previous] ? previous : Object.keys(ready).find(key => ready[key]);
    return fallback ? { ...frame, from: fallback, to: fallback, blend: 0 } : null;
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { HERO, buildTimeline, sampleTimeline, resolveReadyFrame };
    return;
  }
  if (!global.document) return;
  const document = global.document;
  const stage = document.getElementById('cinematic-backdrop');
  if (!stage || typeof global.requestAnimationFrame !== 'function') return;

  const header = document.querySelector('.header');
  const shade = stage.querySelector('.cinematic-shade');
  const layers = Array.from(stage.querySelectorAll('[data-scene]'));
  const reduced = global.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = global.matchMedia('(max-width: 760px)');
  const connection = global.navigator.connection;
  const ready = Object.create(null);
  const requests = new Map();
  const chapters = [
    { selector: '#evaluation', scene: 'cockpit', scale: 1.035, x: -0.3, y: 0.6, shade: 0.34 },
    { selector: '#environment', scene: 'cockpit', scale: 1.09, x: -1.5, y: -0.8, shade: 0.32 },
    { selector: '#benchmark', scene: 'studio', scale: 1.035, x: 0.5, y: 0, shade: 0.34 },
    { selector: '#results', scene: 'studio', scale: 1.075, x: -0.8, y: -0.6, shade: 0.3 },
    { selector: '#insights', scene: 'cockpit', scale: 1.065, x: -0.5, y: -0.4, shade: 0.38 },
    { selector: '#paper', scene: 'studio', scale: 1.025, x: 0, y: 0.1, shade: 0.26 }
  ].map(chapter => ({ ...chapter, node: document.querySelector(chapter.selector) }))
    .filter(chapter => chapter.node);

  let frameRequest = 0;
  let layoutDirty = true;
  let active = false;
  let timeline = [{ ...HERO, at: 0 }];
  let lastScene = 'hero';
  let maximumScroll = 0;

  function schedule() {
    if (!document.hidden && !frameRequest) frameRequest = global.requestAnimationFrame(paint);
  }
  function measureSoon() { layoutDirty = true; schedule(); }
  function measure() {
    const scrollTop = global.scrollY || 0;
    maximumScroll = Math.max(0, document.documentElement.scrollHeight - global.innerHeight);
    const markers = chapters.map(chapter => ({ ...chapter,
      top: chapter.node.getBoundingClientRect().top + scrollTop }));
    timeline = buildTimeline(markers, global.innerHeight, maximumScroll);
    layoutDirty = false;
  }
  function setStyle(element, property, value) {
    if (element.style[property] !== value) element.style[property] = value;
  }

  function paint() {
    frameRequest = 0;
    if (document.hidden) return;
    if (layoutDirty) measure();
    const scrollTop = global.scrollY || 0;
    const lowMotion = reduced.matches || Boolean(connection && connection.saveData);
    const wanted = sampleTimeline(timeline, scrollTop, { reduced: lowMotion, compact: compact.matches });
    loadScene(wanted.from);
    loadScene(wanted.to);
    const frame = resolveReadyFrame(wanted, ready, lastScene);
    if (!active || !frame) return;

    // The lower image is always fully opaque. Fading two independently dimmed
    // images would produce a dark flash in the middle of every transition.
    for (const layer of layers) {
      const name = layer.dataset.scene;
      const isBase = name === frame.from;
      const isBlend = name === frame.to && frame.to !== frame.from;
      setStyle(layer, 'visibility', isBase || isBlend ? 'visible' : 'hidden');
      setStyle(layer, 'zIndex', isBlend ? '1' : '0');
      setStyle(layer, 'opacity', isBase ? '1' : isBlend ? frame.blend.toFixed(4) : '0');
      if (isBase || isBlend) {
        setStyle(layer, 'transform', `translate3d(${frame.x.toFixed(3)}%,${frame.y.toFixed(3)}%,0) scale(${frame.scale.toFixed(4)})`);
      }
    }
    setStyle(shade, 'opacity', frame.shade.toFixed(3));
    lastScene = frame.blend >= 0.5 ? frame.to : frame.from;
    if (stage.dataset.currentScene !== lastScene) stage.dataset.currentScene = lastScene;
    if (header) header.classList.toggle('is-scrolled', scrollTop > 28);
  }

  function loadScene(name) {
    if (requests.has(name)) return requests.get(name);
    const layer = layers.find(item => item.dataset.scene === name);
    if (!layer) return Promise.resolve(false);
    const img = layer.querySelector('img');
    const promise = new Promise(resolve => {
      let settled = false;
      const finish = success => {
        if (settled) return;
        settled = true;
        ready[name] = success;
        resolve(success);
        schedule();
      };
      const decoded = () => {
        if (!img.naturalWidth) { finish(false); return; }
        if (typeof img.decode === 'function') img.decode().then(() => finish(true), () => finish(img.naturalWidth > 0));
        else finish(true);
      };
      img.addEventListener('load', decoded, { once: true });
      img.addEventListener('error', () => finish(false), { once: true });
      if (!img.getAttribute('src')) img.src = img.dataset.src;
      if (img.complete) decoded();
    });
    requests.set(name, promise);
    return promise;
  }

  function preferencesChanged() {
    // Existing content reveals also respect an in-session preference change.
    if (reduced.matches && typeof document.getAnimations === 'function') {
      for (const animation of document.getAnimations()) {
        const target = animation.effect && animation.effect.target;
        if (target && target.matches && target.matches('.section-heading,.finding,.pipeline,.failure-grid')) animation.cancel();
      }
    }
    measureSoon();
  }
  for (const media of [reduced, compact]) {
    if (typeof media.addEventListener === 'function') media.addEventListener('change', preferencesChanged);
    else if (typeof media.addListener === 'function') media.addListener(preferencesChanged);
  }
  if (connection && typeof connection.addEventListener === 'function') connection.addEventListener('change', preferencesChanged);
  global.addEventListener('scroll', schedule, { passive: true });
  global.addEventListener('resize', measureSoon, { passive: true });
  global.addEventListener('pageshow', measureSoon);
  global.addEventListener('hashchange', measureSoon);
  document.addEventListener('toggle', measureSoon, true);
  document.addEventListener('load', measureSoon, true);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && frameRequest) { global.cancelAnimationFrame(frameRequest); frameRequest = 0; }
    else measureSoon();
  });
  if (typeof global.ResizeObserver === 'function') {
    const observer = new global.ResizeObserver(measureSoon);
    observer.observe(document.body);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureSoon);

  loadScene('hero').then(success => {
    if (!success) return; // Existing static hero remains the progressive fallback.
    active = true;
    document.body.classList.add('cinematic-ready');
    measureSoon();
  });
  const warmCache = () => {
    if (!(connection && connection.saveData)) { loadScene('cockpit'); loadScene('studio'); }
  };
  if (typeof global.requestIdleCallback === 'function') global.requestIdleCallback(warmCache, { timeout: 900 });
  else global.setTimeout(warmCache, 200);
})(typeof window !== 'undefined' ? window : globalThis);
