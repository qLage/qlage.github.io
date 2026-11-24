'use strict';

(() => {
  const scene = document.querySelector('.scene');
  const stage = scene.querySelector('.signature');
  const portrait = scene.closest('.portrait');
  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const options = [...scene.querySelectorAll('[data-scene]')];
  const controls = scene.querySelector('.scene-controls');
  const caseLink = scene.querySelector('.scene-case');
  const hint = scene.querySelector('.scene-hint');
  const fragments = scene.querySelectorAll('[data-fragment]');
  const sourcePanel = scene.querySelector('.scene-code');
  const wideScreen = matchMedia('(min-width: 760px)');
  sourcePanel.open = wideScreen.matches;
  wideScreen.addEventListener('change', event => { sourcePanel.open = event.matches; });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const modes = {
    prism: {label: 'Призма', project: 'racs', link: 'Кейс об управлении устройствами', hint: 'Потяните, чтобы повернуть. Касание пускает блик.', yaw: -.48, pitch: -.27},
    wave: {label: 'Волна', project: 'music', link: 'Кейс о боте для минусовок', hint: 'Коснитесь поверхности, чтобы пустить волну.', yaw: -.32, pitch: .54},
    pixels: {label: 'Пиксели', project: 'forum', link: 'Кейс о QR-билетах', hint: 'Нажмите, чтобы рассыпать и собрать QR-код.', yaw: -.28, pitch: -.17}
  };
  let mode = 'pixels';
  let w = 1, h = 1, unit = 1, dpr = 1;
  let yaw = 0, pitch = 0, goalYaw = 0, goalPitch = 0;
  let cosY = 1, sinY = 0, cosP = 1, sinP = 0;
  let lightX = 0, lightY = 0, targetLightX = 0, targetLightY = 0;
  let frame = 0, previousTime = 0, visible = true, rendered = false;
  let started = -2000, previousImage = null, drag = null, taps = [], lastTrace = 0;
  let waveSurface = [];
  let scrollDepth = 0;

  // Surface positions are fixed in model space. Dragging moves the camera.
  function rotate(x, y, z) {
    const side = x * cosY + z * sinY;
    const depth = z * cosY - x * sinY;
    return [side, y * cosP - depth * sinP, y * sinP + depth * cosP];
  }
  function project(x, y, z) {
    const [sx, sy, sz] = rotate(x, y, z);
    const scale = unit * 7 / (7 - sz);
    return [w * .5 + sx * scale, h * .5 - sy * scale, sz, scale];
  }
  function face(points, color, seam = false) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    if (seam) { ctx.lineWidth = .42; ctx.strokeStyle = color; ctx.stroke(); }
  }
  function rgb(r, g, b) {
    return 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b) + ')';
  }

  // An optical torus with lightly cut facets, lit by two moving strip lights.
  function tubeRadius(a, b) {
    const ripple = Math.cos(3 * a + b);
    return .34 + .035 * ripple;
  }
  const ring = [], ringFaces = [];
  const slices = 88, facets = 24;
  for (let i = 0; i < slices; i++) {
    const a = i * tau / slices;
    for (let j = 0; j < facets; j++) {
      const b = j * tau / facets;
      const tube = tubeRadius(a, b);
      const radius = 1.02 + tube * Math.cos(b);
      ring.push([radius * Math.cos(a), radius * Math.sin(a), tube * Math.sin(b)]);
      const midA = a + Math.PI / slices, midB = b + Math.PI / facets;
      const r = (i + 1) % slices, s = (j + 1) % facets;
      ringFaces.push({indices: [i * facets + j, r * facets + j, r * facets + s, i * facets + s],
        normal: [Math.cos(midA) * Math.cos(midB), Math.sin(midA) * Math.cos(midB), Math.sin(midB)], angle: midA});
    }
  }
  function drawPrism(now) {
    const points = ring.map(p => project(...p));
    const faces = [];
    for (const tile of ringFaces) {
      const [nx, ny, nz] = rotate(...tile.normal);
      if (nz < .01) continue;
      const rx = 2 * nx * nz, ry = 2 * ny * nz;
      const line = ry + .46 * rx - .38 - lightY * .42 + scrollDepth * .46;
      const white = Math.exp(-29 * line * line);
      const thin = Math.exp(-145 * (rx - .52 + .25 * ry - lightX * .42) ** 2);
      const blue = Math.exp(-8 * (rx + .7 - .3 * ry - lightX * .34) ** 2);
      const edge = (1 - nz) ** 2.8;
      let flash = 0;
      for (const tap of taps) {
        const t = (now - tap.time) / 1600;
        const angle = tile.angle - t * tau - tap.angle;
        flash += Math.exp(-12 * (1 - Math.cos(angle))) * (1 - t) * tap.power;
      }
      const color = rgb(12 + white*153 + thin*216 + blue*40 + edge*98 + flash*125,
        24 + white*181 + thin*143 + blue*76 + edge*125 + flash*100,
        43 + white*207 + thin*64 + blue*157 + edge*143 + flash*88);
      faces.push({tile, color, depth: tile.indices.reduce((sum, i) => sum + points[i][2], 0)});
    }
    faces.sort((a,b) => a.depth - b.depth);
    for (const {tile,color} of faces) face(tile.indices.map(i => points[i]), color, true);
  }

  // Rows of the membrane share a displacement field. Each touch adds a
  // travelling pulse at the nearest projected surface point.
  function waveHeight(u, v, phase) {
    const swell = Math.sin(4.2*u - 2.6*v + phase*5.2);
    const crest = Math.cos(6*u + 2.7*v - phase*3.4);
    return .42*swell + .24*crest*(1-u*u) + u*.1;
  }
  function drawWave(now) {
    const rows = 44, columns = 69;
    const surface = [], lines = [];
    for (let row = 0; row < rows; row++) {
      const v = 2 * row / (rows - 1) - 1;
      const line = [];
      for (let col = 0; col < columns; col++) {
        const u = 2 * col / (columns - 1) - 1;
        const x = u * 1.82, z = v * (.34 + .68 * Math.sqrt(1 - u*u));
        let y = waveHeight(u, v, scrollDepth);
        for (const tap of taps) {
          const t = (now - tap.time) / 1000;
          const d = Math.hypot(x - tap.x, z - tap.z);
          const front = d - 1.85*t;
          y += tap.power * .43 * Math.exp(-6*front*front - t) * Math.cos(9*front);
        }
        const p = project(x,y,z);
        line.push(p);
        surface.push({px:p[0], py:p[1], x, z});
      }
      lines.push({line,v});
    }
    waveSurface = surface;
    lines.sort((a,b) => a.line[34][2] - b.line[34][2]);
    const light = ctx.createLinearGradient(w*.09, h*.34, w*.9, h*.6);
    const dark = document.documentElement.dataset.theme === 'dark';
    light.addColorStop(0, dark ? '#4e86d7' : '#285194'); light.addColorStop(.31, dark ? '#89cefb' : '#316d91');
    light.addColorStop(.53, dark ? '#edf8ff' : '#596674'); light.addColorStop(.74, dark ? '#bfa8ee' : '#78628a'); light.addColorStop(1, dark ? '#edb77f' : '#995839');
    ctx.strokeStyle = light; ctx.fillStyle = light;
    for (const {line,v} of lines) {
      ctx.globalAlpha = .38 + (v+1)*.22;
      ctx.lineWidth = Math.max(.6, unit*.008);
      ctx.beginPath(); ctx.moveTo(line[0][0],line[0][1]);
      for (const p of line) ctx.lineTo(p[0],p[1]);
      ctx.stroke();
      ctx.globalAlpha = .85;
      const size = Math.max(.9,unit*.011);
      for (let i=0;i<line.length;i+=2) ctx.fillRect(line[i][0],line[i][1],size,size);
    }
    ctx.globalAlpha = 1;
  }

  // Fixed QR payload links to Kirill's public GitHub. Geometry and all
  // interactions are rendered locally. No code is fetched while drawing.
  const matrix = [
    "1111111010110010001111111",
    "1000001010011100101000001",
    "1011101011010110001011101",
    "1011101000011111101011101",
    "1011101010100110101011101",
    "1000001000100110001000001",
    "1111111010101010101111111",
    "0000000000110101000000000",
    "1001111111100011110010111",
    "1110000111001001000111110",
    "0111011101100011010101001",
    "0011110011100011001101111",
    "1010001010100000101100001",
    "1001010101101011010010010",
    "1100101111100111111011111",
    "1011110001001011101101101",
    "1000001011011101111110110",
    "0000000010010000100010110",
    "1111111010001110101010001",
    "1000001010010101100010001",
    "1011101011011011111110000",
    "1011101010101011111000011",
    "1011101001010100010011111",
    "1000001000110011010110111",
    "1111111010011000111001001"
  ];
  const pixels = [];
  matrix.forEach((row, j) => [...row].forEach((bit, i) => {
    if (bit !== '1') return;
    const seed = Math.sin(i*93.47 + j*71.19) * 731.33;
    pixels.push({x:(i-(row.length-1)/2)*.092, y:((matrix.length-1)/2-j)*.092,
      seed: seed - Math.floor(seed), a: seed * tau, delay: .24 * (i + j) / (2 * matrix.length) + .08 * (seed - Math.floor(seed))});
  }));
  function spreadPixel(value, jitter, spread) {
    const offset = value * .48 + .35 * jitter;
    return value + offset * spread;
  }
  function drawPixels(now, progress) {
    const burst = taps.reduce((sum, tap) => {
      const t = (now - tap.time) / 1600;
      return sum + Math.sin(Math.PI * t) * (1 - t) * tap.power;
    }, 0);
    const blocks = [];
    for (const cell of pixels) {
      // A diagonal front seats the cubes before the next row settles.
      const remaining = 1 - clamp((progress - cell.delay) / (1 - cell.delay), 0, 1);
      const spread = remaining ** 3 + burst + scrollDepth * 1.32;
      const x = spreadPixel(cell.x, Math.cos(cell.a), spread);
      const y = spreadPixel(cell.y, Math.sin(cell.a), spread);
      let z = .038 * cell.seed + (.45 + cell.seed * 1.17) * spread;
      const light = Math.exp(-2.8*((x-lightX*1.5)**2+(y+lightY*1.5)**2));
      z += .22*light;
      blocks.push({x,y,z,depth:rotate(x,y,z)[2],seed:cell.seed,light});
    }
    blocks.sort((a,b)=>a.depth-b.depth);
    for (const b of blocks) {
      const half = .043, floor = b.z-.073;
      const quad = [[-half,-half],[half,-half],[half,half],[-half,half]];
      const top = quad.map(([dx,dy])=>project(b.x+dx,b.y+dy,b.z));
      const back = quad.map(([dx,dy])=>project(b.x+dx,b.y+dy,floor));
      const hot = .38 + b.seed*.42 + b.light*.23;
      for (let i=0;i<4;i++) {
        const j=(i+1)%4;
        const cross = (top[j][0]-top[i][0])*(back[i][1]-top[i][1])-(top[j][1]-top[i][1])*(back[i][0]-top[i][0]);
        if (cross>0) face([top[i],top[j],back[j],back[i]],rgb(97*hot,52*hot,67*hot));
      }
      face(top,rgb(105+140*hot,49+147*hot,55+89*hot));
    }
  }

  function schedule() {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function draw(now) {
    frame = 0;
    if (!visible || document.hidden || !w || !h) return;
    const dt = Math.min(64,now-previousTime || 16);
    previousTime = now;
    const follow = reduced.matches ? 1 : 1 - Math.exp(-dt/65);
    yaw += (goalYaw-yaw)*follow; pitch += (goalPitch-pitch)*follow;
    lightX += (targetLightX-lightX)*follow; lightY += (targetLightY-lightY)*follow;
    const duration = mode === 'pixels' ? 920 : 520;
    const t = reduced.matches ? 1 : clamp((now - started) / duration, 0, 1);
    scrollDepth = reduced.matches ? 0 : clamp(window.scrollY / Math.max(1, portrait.offsetHeight * .82), 0, 1);
    const turn = yaw + (1-t)**2*.24 + scrollDepth * (mode === 'prism' ? 1.92 : .64);
    const incline = pitch - scrollDepth * .29;
    cosY = Math.cos(turn); sinY = Math.sin(turn); cosP = Math.cos(incline); sinP = Math.sin(incline);
    unit = Math.min(w*(mode==='wave'?.245:.30),h*(mode==='wave'?.39:.315))*(1-.09*(1-t));
    taps = taps.filter(tap=>now-tap.time<1600);
    ctx.clearRect(0,0,w,h);
    if (mode === 'prism') drawPrism(now);
    else if (mode === 'wave') drawWave(now);
    else drawPixels(now, t);
    if (!rendered) {
      rendered = true;
      stage.classList.add('rendered');
    }
    if (previousImage && t<1) {
      const cut = Math.max(0, (1-t*t*(3-2*t))*h);
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,w,cut); ctx.clip();
      ctx.fillStyle = getComputedStyle(scene).getPropertyValue('--editor'); ctx.fillRect(0,0,w,h);
      ctx.drawImage(previousImage,0,-t*h*.08,w,h); ctx.restore();
    } else { previousImage=null; }
    const settling = Math.abs(goalYaw-yaw)+Math.abs(goalPitch-pitch)+Math.abs(targetLightX-lightX)+Math.abs(targetLightY-lightY)>.002;
    if (t<1 || taps.length || settling) schedule();
  }

  function choose(key, animate = true) {
    if (!Object.hasOwn(modes,key)) key = 'pixels';
    if (animate && !reduced.matches && key!==mode) {
      previousImage=document.createElement('canvas');
      previousImage.width=canvas.width; previousImage.height=canvas.height;
      previousImage.getContext('2d').drawImage(canvas,0,0);
    } else { previousImage=null; }
    mode=key; taps=[]; waveSurface=[]; drag=null;
    stage.classList.remove('dragging');
    yaw=goalYaw=modes[key].yaw; pitch=goalPitch=modes[key].pitch;
    lightX=targetLightX=.1; lightY=targetLightY=-.16;
    options.forEach(option => {
      if(option.dataset.scene===key) option.setAttribute('aria-current','true');
      else option.removeAttribute('aria-current');
    });
    hint.textContent=modes[key].hint;
    fragments.forEach(fragment => { fragment.hidden = fragment.dataset.fragment !== key; });
    caseLink.href='case-'+modes[key].project+'.html';
    caseLink.textContent=modes[key].link+' ↗';
    canvas.setAttribute('aria-label',modes[key].label+' — интерактивная сцена');
    started=performance.now(); schedule();
  }
  function fromLocation() {
    choose(new URL(location.href).searchParams.get('scene'));
  }
  options.forEach(option=>option.addEventListener('click',event=>{
    if(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.button!==0) return;
    event.preventDefault();
    if(option.dataset.scene===mode) return;
    const url=new URL(location.href); url.searchParams.set('scene',option.dataset.scene); url.hash='';
    history.pushState(null,'',url); choose(option.dataset.scene);
  }));
  window.addEventListener('popstate',fromLocation);
  function lightAt(x,y) {
    targetLightX=clamp(2*x/w-1,-1,1); targetLightY=clamp(2*y/h-1,-1,1);
  }
  function pulse(x,y,power=1) {
    if(reduced.matches) {
      goalYaw+=.12*power; lightAt(x,y); schedule(); return;
    }
    let nearest={x:0,z:0}, distance=Infinity;
    if(mode==='wave') for(const p of waveSurface) {
      const d=(p.px-x)**2+(p.py-y)**2;
      if(d<distance) {nearest=p;distance=d;}
    }
    taps=taps.slice(-3);
    taps.push({time:performance.now(),x:nearest.x,z:nearest.z,angle:Math.atan2(h/2-y,x-w/2),power});
    schedule();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(!e.isPrimary || e.button!==0) return;
    const box=canvas.getBoundingClientRect();
    started = -2000; previousImage = null;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,yaw:goalYaw,pitch:goalPitch};
    canvas.setPointerCapture(e.pointerId); stage.classList.add('dragging');
    lightAt(e.clientX-box.left,e.clientY-box.top);
    pulse(e.clientX-box.left,e.clientY-box.top);
  });
  canvas.addEventListener('pointermove',e=>{
    if(!e.isPrimary) return;
    const box=canvas.getBoundingClientRect(), x=e.clientX-box.left,y=e.clientY-box.top;
    lightAt(x,y);
    if(drag && e.pointerId===drag.id) {
      goalYaw=drag.yaw+(e.clientX-drag.x)/w*3.8;
      goalPitch=clamp(drag.pitch+(e.clientY-drag.y)/h*2,-1.22,1.22);
    }
    if(mode==='wave' && performance.now()-lastTrace>160 && !reduced.matches) {
      pulse(x,y,.48); lastTrace=performance.now();
    }
    schedule();
  });
  canvas.addEventListener('lostpointercapture',()=>{drag=null;stage.classList.remove('dragging');});
  canvas.addEventListener('pointerleave',()=>{if(!drag){targetLightX=.1;targetLightY=-.16;schedule();}});
  canvas.addEventListener('keydown',e=>{
    switch(e.key) {
      case 'ArrowLeft': goalYaw-=.20; break;
      case 'ArrowRight': goalYaw+=.20; break;
      case 'ArrowUp': goalPitch=clamp(goalPitch-.15,-1.22,1.22); break;
      case 'ArrowDown': goalPitch=clamp(goalPitch+.15,-1.22,1.22); break;
      case ' ': case 'Enter': pulse(w*.56,h*.45); break;
      case 'Home': choose(mode,false); break;
      default: return;
    }
    e.preventDefault();schedule();
  });
  function resize() {
    w=stage.clientWidth; h=stage.clientHeight; dpr=Math.min(devicePixelRatio || 1,2);
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);previousImage=null;schedule();
  }
  choose(new URL(location.href).searchParams.get('scene'),false);
  controls.hidden = false;
  hint.hidden = false;
  window.addEventListener('portfolio-theme', schedule);
  new ResizeObserver(resize).observe(stage);
  new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)schedule();}).observe(stage);
  window.addEventListener('scroll', () => { if (!reduced.matches) schedule(); }, {passive: true});
  document.addEventListener('visibilitychange',schedule);
  reduced.addEventListener('change',()=>{taps=[];previousImage=null;started=-2000;schedule();});
  resize();
})();
