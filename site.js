'use strict';

function installTheme() {
  const button = document.querySelector('.theme-switch');
  const color = document.querySelector('meta[name="theme-color"]');
  function apply(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    button.setAttribute('aria-pressed', String(dark));
    button.title = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
    color.content = dark ? '#171816' : '#f4f2eb';
    window.dispatchEvent(new Event('portfolio-theme'));
  }
  apply(document.documentElement.dataset.theme === 'dark');
  button.hidden = false;
  button.addEventListener('click', () => {
    apply(document.documentElement.dataset.theme !== 'dark');
    try { localStorage.setItem('portfolio-theme', document.documentElement.dataset.theme); } catch {}
  });
  window.addEventListener('storage', event => {
    if (event.key === 'portfolio-theme') apply(event.newValue === 'dark');
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      try { apply(localStorage.getItem('portfolio-theme') === 'dark'); } catch {}
    }
  });
}

installTheme();

function installIndex() {
  const index = document.querySelector('.project-index');
  if (!index) return;
  const list = index.querySelector('.entries');
  const entries = [...list.querySelectorAll('.entry')];
  const stack = index.querySelector('.sample-stack');
  const samples = [...stack.querySelectorAll('.sample')];
  const pictures = samples.map(sample => sample.querySelector('.sample-art img'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = document.createElement('span');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.hidden = true;
  const overlayImage = new Image();
  overlayImage.alt = '';
  overlay.append(overlayImage);
  stack.append(overlay);

  let active = -1;
  let layer = -1;
  let manualAt = null;
  let wipe;

  function showSample(number) {
    if (number === active) return;
    active = number;
    samples.forEach((sample, i) => { sample.hidden = i !== number; });
    entries.forEach((entry, i) => entry.classList.toggle('is-previewed', i === number));
  }

  function showOverlay(number, top, bottom) {
    if (layer !== number) {
      layer = number;
      overlay.className = 'sample-art departing-art theme-' + entries[number].dataset.key;
      overlayImage.src = pictures[number].src;
    }
    overlay.hidden = false;
    overlay.style.clipPath = 'inset(' + top + '% 0 ' + bottom + '% 0 round 12px)';
  }

  function marker(position) {
    list.style.setProperty('--marker-y', position.toFixed(1) + 'px');
  }

  function choose(number) {
    manualAt = window.scrollY;
    const old = active;
    showSample(number);
    const row = entries[number].parentElement;
    marker(row.offsetTop + row.offsetHeight / 2);
    if (old === number || !stack.clientWidth) {
      if (!wipe) overlay.hidden = true;
      return;
    }
    wipe?.cancel();
    overlay.hidden = true;
    if (old < 0 || reduced.matches) return;
    showOverlay(old, 0, 0);
    if (!overlay.animate) { overlay.hidden = true; return; }
    const transition = overlay.animate([{clipPath: 'inset(0 0 0 0 round 12px)'},
      {clipPath: 'inset(0 0 100% 0 round 12px)'}], {duration: 320, easing: 'ease-out'});
    wipe = transition;
    transition.onfinish = () => {
      if (wipe === transition) { overlay.hidden = true; wipe = null; }
    };
  }

  for (const [number, entry] of entries.entries()) {
    entry.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch') choose(number);
    });
    entry.addEventListener('focus', () => choose(number));
  }
  const previousURL = window.navigation?.activation?.from?.url;
  const previous = entries.findIndex(entry => previousURL && new URL(previousURL).pathname === new URL(entry.href).pathname);
  if (previous >= 0) choose(previous);
  else showSample(0);

  return function followScroll(viewHeight, scrollY) {
    if (!stack.clientWidth || stack.contains(document.activeElement)) return;
    if (manualAt !== null && Math.abs(scrollY - manualAt) < 2) return;
    manualAt = null;
    const box = list.getBoundingClientRect();
    if (box.bottom < 0 || box.top > viewHeight) return;
    // Measure all rows before changing the selected link or the overlay.
    const centers = entries.map(entry => {
      const row = entry.parentElement;
      return row.offsetTop + row.offsetHeight / 2;
    });
    const readingLine = viewHeight * .43 - box.top;
    let lower = 0;
    while (lower + 1 < centers.length && centers[lower + 1] <= readingLine) lower++;
    const upper = Math.min(centers.length - 1, lower + 1);
    const between = clamp01((readingLine - centers[lower]) / (centers[upper] - centers[lower] || 1));
    const amount = clamp01((between - .22) / .56);
    const selected = amount < .5 ? lower : upper;
    wipe?.cancel();
    wipe = null;
    showSample(selected);
    marker(reduced.matches ? centers[selected] : centers[lower] + (centers[upper] - centers[lower]) * between);
    if (amount === 0 || amount === 1 || lower === upper || reduced.matches) {
      overlay.hidden = true;
    } else if (selected === lower) {
      showOverlay(upper, (1 - amount) * 100, 0);
    } else {
      showOverlay(lower, 0, amount * 100);
    }
  };
}

function installGallery() {
  const gallery = document.querySelector('.gallery');
  if (!gallery) return;
  const stage = gallery.querySelector('.screen-stage');
  const image = stage.querySelector('img');
  const thumbs = [...gallery.querySelectorAll('.thumb')];
  const viewer = document.querySelector('.viewer');
  const full = viewer.querySelector('.viewer-image img');
  const frame = full.parentElement;
  const zoom = viewer.querySelector('.zoom');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let current = 0;

  function resetZoom() {
    frame.classList.remove('original');
    frame.scrollTo(0, 0);
    zoom.textContent = 'Оригинальный размер';
    zoom.setAttribute('aria-pressed', 'false');
  }
  function syncViewer() {
    const selected = thumbs[current];
    full.src = selected.href;
    full.alt = selected.dataset.label;
    viewer.querySelector('.viewer-title').textContent = selected.dataset.label;
    viewer.querySelector('.page-number').textContent = (current + 1) + ' / ' + thumbs.length;
    resetZoom();
  }
  function select(index) {
    current = (index + thumbs.length) % thumbs.length;
    const selected = thumbs[current];
    for (const thumb of thumbs) {
      if (thumb === selected) thumb.setAttribute('aria-current', 'true');
      else thumb.removeAttribute('aria-current');
    }
    stage.href = selected.href;
    image.src = selected.href;
    image.alt = selected.dataset.label;
    gallery.querySelector('.frame-title').textContent = selected.dataset.label;
    gallery.querySelector('.frame-description').textContent = selected.dataset.description;
    if (!reduceMotion.matches && image.animate) {
      image.animate([{opacity: .55}, {opacity: 1}], {duration: 190});
    }
    if (viewer.open) syncViewer();
  }

  thumbs.forEach((thumb, index) => thumb.addEventListener('click', event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    select(index);
  }));
  full.addEventListener('load', () => {
    frame.classList.toggle('long', full.naturalHeight > full.naturalWidth * 1.8);
  });
  stage.addEventListener('click', event => {
    if (typeof viewer.showModal !== 'function' || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    viewer.showModal();
    syncViewer();
    viewer.querySelector('.close-view').focus();
  });
  viewer.querySelector('.close-view').addEventListener('click', () => viewer.close());
  viewer.querySelector('.prev').addEventListener('click', () => select(current - 1));
  viewer.querySelector('.forward').addEventListener('click', () => select(current + 1));
  viewer.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    select(current + (event.key === 'ArrowRight' ? 1 : -1));
  });
  zoom.addEventListener('click', () => {
    const original = frame.classList.toggle('original');
    zoom.setAttribute('aria-pressed', String(original));
    zoom.textContent = original ? 'Вписать в экран' : 'Оригинальный размер';
    frame.scrollTo(0, 0);
  });
  viewer.addEventListener('click', event => {
    if (event.target === viewer) viewer.close();
  });
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function installScroll(followIndex) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const targets = [...document.querySelectorAll('[data-enter], .profile-records > div')];
  const chapters = [...document.querySelectorAll('.chapters a')].map(link => ({
    link, section: document.getElementById(link.hash.slice(1))
  }));
  const cache = new Map();
  let ticking = false;

  // Keep the original text and its spacing intact for search, selection and speech.
  for (const target of targets) {
    if (target.matches('p[data-enter="copy"]') && !target.childElementCount) {
      const words = target.textContent.split(/(\s+)/);
      const parts = words.map((word, i) => {
        if (!word.trim()) return document.createTextNode(word);
        const span = document.createElement('span');
        span.className = 'ink-word';
        span.style.setProperty('--word', (i / words.length).toFixed(3));
        span.textContent = word;
        return span;
      });
      target.replaceChildren(...parts);
    }
    if (target.dataset.enter === 'heading') {
      const title = document.createElement('span');
      title.className = 'scroll-title';
      title.append(...target.childNodes);
      target.append(title);
    }
  }

  function update() {
    ticking = false;
    const viewHeight = document.documentElement.clientHeight;
    const scrollY = window.scrollY;
    const endOfPage = Math.max(0, document.documentElement.scrollHeight - viewHeight);
    const changes = [];
    if (!reduced.matches) {
      for (const target of targets) {
        const box = target.getBoundingClientRect();
        if (!box.height || box.bottom < 0 || box.top > viewHeight + 12) continue;
        const top = scrollY + box.top;
        const start = Math.max(0, top - viewHeight);
        const finish = Math.min(endOfPage, top - viewHeight * .44);
        const remaining = finish > start ? 1 - clamp01((scrollY - start) / (finish - start)) : 0;
        const value = remaining.toFixed(3);
        if (value !== cache.get(target)) changes.push([target, value]);
      }
    }
    const readingLine = Math.min(viewHeight * .38, 300);
    const current = chapters.filter(chapter => chapter.section.getBoundingClientRect().top <= readingLine).at(-1);
    followIndex?.(viewHeight, scrollY);
    for (const [target, value] of changes) {
      target.style.setProperty('--unseen', value);
      cache.set(target, value);
    }
    for (const chapter of chapters) {
      if (chapter === current) chapter.link.setAttribute('aria-current', 'location');
      else chapter.link.removeAttribute('aria-current');
    }
  }
  function schedule() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }
  window.addEventListener('scroll', schedule, {passive: true});
  window.addEventListener('resize', schedule);
  window.addEventListener('pageshow', schedule);
  reduced.addEventListener('change', schedule);
  if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(document.body);
  document.fonts?.ready.then(schedule);
  update();
}

installScroll(installIndex());
installGallery();
