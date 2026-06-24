"use strict";

const MODES = {
  0: {
    name: "Pointillist reconstruction",
    description: "Particles chase sampled image pixels with soft additive color.",
  },
  1: {
    name: "Thread art",
    description: "Fine lines stay tethered to the source image like luminous string.",
  },
  3: {
    name: "Ink diffusion",
    description: "Soft particles bleed outward before settling into the image.",
  },
  6: {
    name: "Swarming agents",
    description: "Agents orbit, flock, and spiral into their target colors.",
  },
  7: {
    name: "Vortex loom",
    description: "Drag to weave particle trails into spiraling bands around the image.",
  },
  8: {
    name: "Magnetic filings",
    description: "Filament lines align to a moving magnetic field over the image.",
  },
  9: {
    name: "Cellular growth",
    description: "Round cells expand from the center until the image blooms.",
  },
};

const DEFAULT_IMAGES = {
  demo: { label: "Generated demo image", src: null },
  gold: { label: "Gold portrait", src: "./assets/default-images/gold-portrait.png" },
  fox: { label: "Iridescent fox", src: "./assets/default-images/iridescent-fox.png" },
  halo: { label: "Halo world", src: "./assets/default-images/halo-world.jpeg" },
  nebula: { label: "Space nebula", src: "./assets/default-images/space-nebula.png" },
  knight: { label: "Rainbow knight", src: "./assets/default-images/rainbow-knight.png" },
};

const BRAND_MAX_PARTICLES = 1200;
const BRAND_TARGET_FPS = 24;

const canvas = document.querySelector("#glCanvas");
const brandCanvas = document.querySelector("#brandCanvas");
const unsupportedMessage = document.querySelector("#unsupportedMessage");
const modeSelect = document.querySelector("#modeSelect");
const defaultImageSelect = document.querySelector("#defaultImageSelect");
const imageInput = document.querySelector("#imageInput");
const dropZone = document.querySelector("#dropZone");
const sourceName = document.querySelector("#sourceName");
const particleCount = document.querySelector("#particleCount");
const particleOutput = document.querySelector("#particleOutput");
const rebuildButton = document.querySelector("#rebuildButton");
const speedRange = document.querySelector("#speedRange");
const speedOutput = document.querySelector("#speedOutput");
const energyRange = document.querySelector("#energyRange");
const energyOutput = document.querySelector("#energyOutput");
const sizeRange = document.querySelector("#sizeRange");
const sizeOutput = document.querySelector("#sizeOutput");
const lineRange = document.querySelector("#lineRange");
const lineOutput = document.querySelector("#lineOutput");
const scatterButton = document.querySelector("#scatterButton");
const freezeButton = document.querySelector("#freezeButton");
const rendererStatus = document.querySelector("#rendererStatus");
const fpsStatus = document.querySelector("#fpsStatus");
const imageStatus = document.querySelector("#imageStatus");
const modeTitle = document.querySelector("#modeTitle");
const modeDescription = document.querySelector("#modeDescription");

const gl = canvas.getContext("webgl2", {
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  powerPreference: "high-performance",
  premultipliedAlpha: false,
});

const state = {
  mode: Number(modeSelect.value),
  count: Number(particleCount.value),
  speed: Number(speedRange.value),
  energy: Number(energyRange.value),
  particleScale: Number(sizeRange.value),
  lineDensity: Number(lineRange.value),
  paused: false,
  current: 0,
  initialized: false,
  source: null,
  baseTargets: null,
  targets: null,
  colors: null,
  seeds: null,
  frame: { width: 1.82, height: 1.82 },
  mouse: { x: 5, y: 5, px: 5, py: 5, dx: 0, dy: 0, active: 0, strength: 0 },
  lastResizeAspect: 0,
};

const brandState = {
  particles: [],
  lastWidth: 0,
  lastHeight: 0,
  lastRenderTime: 0,
  random: mulberry32(0xC0FFEE),
};

let programs;
let buffers;
let geometry;
let animationId = 0;
let lastTime = performance.now();
let fpsTime = lastTime;
let fpsFrames = 0;
let rebuildQueued = false;
let pointSizeLimit = [1, 64];

function boot() {
  pointSizeLimit = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  programs = createPrograms();
  geometry = createGeometry();
  buffers = createBuffers();
  rendererStatus.textContent = getRendererLabel();
  bindUi();
  updateUiLabels();
  resizeCanvas();
  setupBrandParticles();
  loadDefaultImage(defaultImageSelect.value);
  animationId = requestAnimationFrame(tick);
}

function bindUi() {
  window.addEventListener("resize", resizeCanvas);

  modeSelect.addEventListener("change", () => {
    state.mode = Number(modeSelect.value);
    updateModeCopy();
  });

  defaultImageSelect.addEventListener("change", () => {
    loadDefaultImage(defaultImageSelect.value);
  });

  particleCount.addEventListener("input", () => {
    particleOutput.textContent = formatCount(Number(particleCount.value));
  });

  rebuildButton.addEventListener("click", () => {
    state.count = Number(particleCount.value);
    queueRebuild();
  });

  speedRange.addEventListener("input", () => {
    state.speed = Number(speedRange.value);
    speedOutput.textContent = state.speed.toFixed(2);
  });

  energyRange.addEventListener("input", () => {
    state.energy = Number(energyRange.value);
    energyOutput.textContent = state.energy.toFixed(2);
  });

  sizeRange.addEventListener("input", () => {
    state.particleScale = Number(sizeRange.value);
    sizeOutput.textContent = state.particleScale.toFixed(2);
  });

  lineRange.addEventListener("input", () => {
    state.lineDensity = Number(lineRange.value);
    lineOutput.textContent = state.lineDensity.toFixed(2);
  });

  scatterButton.addEventListener("click", () => {
    scatterParticles();
  });

  freezeButton.addEventListener("click", () => {
    state.paused = !state.paused;
    freezeButton.textContent = state.paused ? "Resume" : "Pause";
    freezeButton.setAttribute("aria-pressed", String(state.paused));
  });

  imageInput.addEventListener("change", () => {
    const file = imageInput.files && imageInput.files[0];
    if (file) {
      defaultImageSelect.value = "custom";
      loadImageFile(file);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  });

  dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      defaultImageSelect.value = "custom";
      loadImageFile(file);
    }
  });

  canvas.addEventListener("pointermove", updatePointer);
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    updatePointer(event);
    state.mouse.active = 1;
  });
  canvas.addEventListener("pointerup", (event) => {
    canvas.releasePointerCapture(event.pointerId);
    state.mouse.active = 0;
  });
  canvas.addEventListener("pointerleave", () => {
    state.mouse.active = 0;
  });
}

function updateUiLabels() {
  particleOutput.textContent = formatCount(state.count);
  speedOutput.textContent = state.speed.toFixed(2);
  energyOutput.textContent = state.energy.toFixed(2);
  sizeOutput.textContent = state.particleScale.toFixed(2);
  lineOutput.textContent = state.lineDensity.toFixed(2);
  updateModeCopy();
}

function updateModeCopy() {
  const mode = MODES[state.mode] || MODES[1];
  modeTitle.textContent = mode.name;
  modeDescription.textContent = mode.description;
}

function resizeCanvas() {
  if (!gl) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(2, Math.floor(rect.width * dpr));
  const height = Math.max(2, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  }
  const aspect = rect.width / Math.max(1, rect.height);
  if (Math.abs(aspect - state.lastResizeAspect) > 0.015) {
    state.lastResizeAspect = aspect;
    updateFrameBounds();
    if (state.initialized) {
      rebuildTargetBuffer();
    }
  }
  resizeBrandCanvas();
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = (1 - (event.clientY - rect.top) / rect.height) * 2 - 1;
  if (state.mouse.x < 2.5 && state.mouse.y < 2.5) {
    state.mouse.px = state.mouse.x;
    state.mouse.py = state.mouse.y;
  } else {
    state.mouse.px = x;
    state.mouse.py = y;
  }
  state.mouse.x = x;
  state.mouse.y = y;
  state.mouse.dx = x - state.mouse.px;
  state.mouse.dy = y - state.mouse.py;
  state.mouse.strength = Math.min(
    1,
    Math.hypot(state.mouse.dx, state.mouse.dy) * 9 + (event.buttons ? 0.55 : 0.2),
  );
  state.mouse.active = event.buttons ? 1 : 0.45;
}

function setupBrandParticles() {
  resizeBrandCanvas(true);
}

function resizeBrandCanvas(force = false) {
  if (!brandCanvas) return;
  const rect = brandCanvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const width = Math.max(2, Math.floor(rect.width * dpr));
  const height = Math.max(2, Math.floor(rect.height * dpr));
  if (!force && width === brandState.lastWidth && height === brandState.lastHeight) {
    return;
  }

  brandCanvas.width = width;
  brandCanvas.height = height;
  brandState.lastWidth = width;
  brandState.lastHeight = height;
  buildBrandParticles(width, height);
}

function buildBrandParticles(width, height) {
  const offscreen = document.createElement("canvas");
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext("2d", { willReadFrequently: true });
  const random = mulberry32(width * 131 + height * 17 + 0xC0FFEE);
  const fontSize = Math.max(14, Math.floor(width * 0.1));
  const text = "CHCOfficial";

  ctx.clearRect(0, 0, width, height);
  ctx.font = `900 ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = Math.max(2, fontSize * 0.06);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillStyle = "rgba(255, 255, 255, 1)";
  ctx.strokeText(text, width * 0.5, height * 0.52);
  ctx.fillText(text, width * 0.5, height * 0.52);

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const step = Math.max(2, Math.floor(width / 86));
  const palette = [
    [137, 241, 255],
    [177, 151, 255],
    [255, 124, 202],
    [255, 226, 163],
    [151, 255, 215],
  ];
  const particles = [];

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha > 80 && random() > 0.12) {
        const color = palette[Math.floor(random() * palette.length)];
        particles.push({
          x: x + (random() - 0.5) * width * 0.07,
          y: y + (random() - 0.5) * height * 0.34,
          vx: 0,
          vy: 0,
          tx: x,
          ty: y,
          size: 1.15 + random() * 0.85,
          phase: random() * Math.PI * 2,
          color: `rgba(${color[0]}, ${color[1]}, ${color[2]}, `,
        });
      }
    }
  }

  brandState.particles = capParticleList(particles, BRAND_MAX_PARTICLES);
}

function renderBrandParticles(time, dt) {
  if (!brandCanvas || brandState.particles.length === 0) return;
  const frameInterval = 1 / BRAND_TARGET_FPS;
  if (time - brandState.lastRenderTime < frameInterval) return;
  const elapsed = brandState.lastRenderTime ? time - brandState.lastRenderTime : dt;
  brandState.lastRenderTime = time;

  const ctx = brandCanvas.getContext("2d");
  const width = brandCanvas.width;
  const height = brandCanvas.height;

  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  const pace = Math.min(1.4, elapsed * 42);
  for (const particle of brandState.particles) {
    const dx = particle.tx - particle.x;
    const dy = particle.ty - particle.y;
    const drift = Math.sin(time * 1.7 + particle.phase) * 0.018;
    particle.vx = particle.vx * 0.82 + (dx * 0.038 - dy * drift) * pace;
    particle.vy = particle.vy * 0.82 + (dy * 0.038 + dx * drift) * pace;
    particle.x += particle.vx * pace;
    particle.y += particle.vy * pace;

    const pulse = 0.72 + Math.sin(time * 2.3 + particle.phase) * 0.22;
    const size = particle.size * pulse;
    const glowSize = size * 1.85;
    ctx.fillStyle = `${particle.color}${0.2 + pulse * 0.1})`;
    ctx.fillRect(particle.x - glowSize * 0.5, particle.y - glowSize * 0.5, glowSize, glowSize);
    ctx.fillStyle = `${particle.color}${0.82 + pulse * 0.18})`;
    ctx.fillRect(particle.x - size * 0.5, particle.y - size * 0.5, size, size);
  }
  ctx.globalCompositeOperation = "source-over";
}

function capParticleList(particles, limit) {
  if (particles.length <= limit) return particles;
  const capped = [];
  const stride = particles.length / limit;
  for (let i = 0; i < limit; i += 1) {
    capped.push(particles[Math.floor(i * stride)]);
  }
  return capped;
}

function getRendererLabel() {
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  if (!debugInfo) return "WebGL2 transform feedback";
  const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
  return renderer || "WebGL2 transform feedback";
}

function createPrograms() {
  const updateProgram = createProgram(
    UPDATE_VERTEX_SHADER,
    PASSTHROUGH_FRAGMENT_SHADER,
    ["v_position", "v_velocity"],
  );
  const pointProgram = createProgram(POINT_VERTEX_SHADER, POINT_FRAGMENT_SHADER);
  const lineProgram = createProgram(LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
  const strokeProgram = createProgram(STROKE_VERTEX_SHADER, STROKE_FRAGMENT_SHADER);
  return {
    update: introspectProgram(updateProgram),
    point: introspectProgram(pointProgram),
    line: introspectProgram(lineProgram),
    stroke: introspectProgram(strokeProgram),
  };
}

function createProgram(vertexSource, fragmentSource, varyings) {
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  if (varyings) {
    gl.transformFeedbackVaryings(program, varyings, gl.SEPARATE_ATTRIBS);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(error || "Unable to link WebGL program");
  }
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || "Unable to compile WebGL shader");
  }
  return shader;
}

function introspectProgram(program) {
  const attributes = {};
  const uniforms = {};
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < attributeCount; i += 1) {
    const info = gl.getActiveAttrib(program, i);
    attributes[info.name] = gl.getAttribLocation(program, info.name);
  }
  for (let i = 0; i < uniformCount; i += 1) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name] = gl.getUniformLocation(program, info.name);
  }
  return { program, attributes, uniforms };
}

function createBuffers() {
  return {
    positions: [gl.createBuffer(), gl.createBuffer()],
    velocities: [gl.createBuffer(), gl.createBuffer()],
    targets: gl.createBuffer(),
    colors: gl.createBuffer(),
    seeds: gl.createBuffer(),
    transformFeedback: gl.createTransformFeedback(),
  };
}

function createGeometry() {
  const lineEndpoints = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lineEndpoints);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1]), gl.STATIC_DRAW);

  const quadCorners = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadCorners);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    gl.STATIC_DRAW,
  );

  return { lineEndpoints, quadCorners };
}

function loadDefaultImage(key) {
  const preset = DEFAULT_IMAGES[key] || DEFAULT_IMAGES.demo;
  if (!preset.src) {
    loadDemoImage();
    return;
  }

  sourceName.textContent = `Loading ${preset.label}`;
  const image = new Image();
  image.onload = () => {
    setSourceCanvas(image, preset.label);
  };
  image.onerror = () => {
    sourceName.textContent = `Could not load ${preset.label}`;
  };
  image.src = preset.src;
}

function loadDemoImage() {
  const demo = document.createElement("canvas");
  demo.width = 860;
  demo.height = 620;
  const ctx = demo.getContext("2d", { willReadFrequently: true });

  const backdrop = ctx.createLinearGradient(0, 0, demo.width, demo.height);
  backdrop.addColorStop(0, "#141714");
  backdrop.addColorStop(0.4, "#214c43");
  backdrop.addColorStop(0.72, "#f05f48");
  backdrop.addColorStop(1, "#f6d778");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, demo.width, demo.height);

  drawDemoGlow(ctx, 210, 190, 240, "rgba(54, 214, 179, 0.55)");
  drawDemoGlow(ctx, 650, 410, 270, "rgba(255, 107, 74, 0.48)");
  drawDemoGlow(ctx, 510, 190, 160, "rgba(255, 209, 102, 0.5)");

  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 42; i += 1) {
    const t = i / 41;
    ctx.strokeStyle = `rgba(${70 + t * 150}, ${210 - t * 50}, ${185 + t * 45}, 0.18)`;
    ctx.lineWidth = 10 + Math.sin(t * Math.PI) * 16;
    ctx.beginPath();
    ctx.moveTo(-80 + t * 240, demo.height + 40);
    ctx.bezierCurveTo(260, 80 + t * 220, 500, 580 - t * 320, demo.width + 80, 80 + t * 420);
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(8, 9, 6, 0.38)";
  ctx.beginPath();
  ctx.ellipse(430, 330, 170, 210, -0.18, 0, Math.PI * 2);
  ctx.fill();

  const face = ctx.createRadialGradient(380, 250, 30, 430, 315, 210);
  face.addColorStop(0, "#ffe6bd");
  face.addColorStop(0.48, "#e77f63");
  face.addColorStop(1, "#273a34");
  ctx.fillStyle = face;
  ctx.beginPath();
  ctx.ellipse(430, 310, 120, 160, -0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(15, 18, 14, 0.72)";
  ctx.beginPath();
  ctx.moveTo(320, 260);
  ctx.bezierCurveTo(365, 115, 545, 165, 560, 320);
  ctx.bezierCurveTo(530, 248, 455, 240, 395, 278);
  ctx.bezierCurveTo(360, 300, 334, 300, 320, 260);
  ctx.fill();

  ctx.strokeStyle = "rgba(255, 241, 210, 0.85)";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(382, 326);
  ctx.quadraticCurveTo(430, 355, 492, 318);
  ctx.stroke();

  ctx.fillStyle = "rgba(8, 9, 6, 0.75)";
  ctx.beginPath();
  ctx.ellipse(390, 282, 13, 7, -0.12, 0, Math.PI * 2);
  ctx.ellipse(474, 282, 13, 7, 0.14, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(54, 214, 179, 0.65)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    const r = 240 + Math.sin(i * 1.7) * 50;
    ctx.beginPath();
    ctx.moveTo(430 + Math.cos(a) * 155, 320 + Math.sin(a) * 200);
    ctx.lineTo(430 + Math.cos(a) * r, 320 + Math.sin(a) * r * 0.72);
    ctx.stroke();
  }

  setSourceCanvas(demo, "Generated demo image");
}

function drawDemoGlow(ctx, x, y, radius, color) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    setSourceCanvas(image, file.name);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    sourceName.textContent = "Could not load image";
  };
  image.src = url;
}

function setSourceCanvas(source, name) {
  const maxDimension = 920;
  const scale = Math.min(1, maxDimension / Math.max(source.width, source.height));
  const sample = document.createElement("canvas");
  sample.width = Math.max(2, Math.round(source.width * scale));
  sample.height = Math.max(2, Math.round(source.height * scale));
  const ctx = sample.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, sample.width, sample.height);
  ctx.drawImage(source, 0, 0, sample.width, sample.height);
  const imageData = ctx.getImageData(0, 0, sample.width, sample.height);

  state.source = {
    name,
    width: sample.width,
    height: sample.height,
    pixels: imageData.data,
  };
  sourceName.textContent = name;
  imageStatus.textContent = `${sample.width} x ${sample.height}`;
  queueRebuild();
}

function queueRebuild() {
  if (!state.source || rebuildQueued) return;
  rebuildQueued = true;
  rendererStatus.textContent = `Building ${formatCount(state.count)} particles`;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    buildParticleField();
  });
}

function buildParticleField() {
  const source = state.source;
  const count = state.count;
  const random = mulberry32(hashString(source.name) ^ count);
  const aspect = source.width / source.height;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * aspect)));
  const rows = Math.ceil(count / columns);
  const totalCells = columns * rows;
  let cellStride = Math.max(1, Math.floor(totalCells * 0.61803398875));
  while (gcd(cellStride, totalCells) !== 1) {
    cellStride += 1;
  }

  state.baseTargets = new Float32Array(count * 2);
  state.targets = new Float32Array(count * 2);
  state.colors = new Float32Array(count * 4);
  state.seeds = new Float32Array(count);

  const positions = new Float32Array(count * 2);
  const velocities = new Float32Array(count * 2);

  for (let i = 0; i < count; i += 1) {
    const cell = (i * cellStride) % totalCells;
    const column = cell % columns;
    const row = Math.floor(cell / columns);
    const jitterX = random() * 0.82 + 0.09;
    const jitterY = random() * 0.82 + 0.09;
    const u = Math.min(0.999, (column + jitterX) / columns);
    const v = Math.min(0.999, (row + jitterY) / rows);
    const px = Math.min(source.width - 1, Math.floor(u * source.width));
    const py = Math.min(source.height - 1, Math.floor(v * source.height));
    const pixelIndex = (py * source.width + px) * 4;
    const alpha = source.pixels[pixelIndex + 3] / 255;
    const colorIndex = i * 4;
    const positionIndex = i * 2;
    const seed = random();

    state.baseTargets[positionIndex] = u * 2 - 1;
    state.baseTargets[positionIndex + 1] = 1 - v * 2;
    state.colors[colorIndex] = srgbToLinear(source.pixels[pixelIndex] / 255) * alpha;
    state.colors[colorIndex + 1] = srgbToLinear(source.pixels[pixelIndex + 1] / 255) * alpha;
    state.colors[colorIndex + 2] = srgbToLinear(source.pixels[pixelIndex + 2] / 255) * alpha;
    state.colors[colorIndex + 3] = Math.max(0.08, alpha);
    state.seeds[i] = seed * 1000 + i * 0.000013;

    const angle = seed * Math.PI * 2 + i * 2.39996323;
    const radius = 1.15 + random() * 0.95;
    positions[positionIndex] = Math.cos(angle) * radius;
    positions[positionIndex + 1] = Math.sin(angle) * radius;
    velocities[positionIndex] = Math.cos(angle + 1.7) * 0.04;
    velocities[positionIndex + 1] = Math.sin(angle - 0.4) * 0.04;
  }

  updateFrameBounds();
  writeTargetPositions();
  uploadParticleBuffers(positions, velocities);
  state.initialized = true;
  state.current = 0;
  rendererStatus.textContent = `${formatCount(count)} GPU particles`;
}

function updateFrameBounds() {
  if (!state.source) return;
  const rect = canvas.getBoundingClientRect();
  const canvasAspect = rect.width / Math.max(1, rect.height);
  const imageAspect = state.source.width / state.source.height;
  const margin = 1.86;
  if (imageAspect > canvasAspect) {
    state.frame.width = margin;
    state.frame.height = margin * (canvasAspect / imageAspect);
  } else {
    state.frame.height = margin;
    state.frame.width = margin * (imageAspect / canvasAspect);
  }
}

function writeTargetPositions() {
  const width = state.frame.width * 0.5;
  const height = state.frame.height * 0.5;
  for (let i = 0; i < state.count; i += 1) {
    const index = i * 2;
    state.targets[index] = state.baseTargets[index] * width;
    state.targets[index + 1] = state.baseTargets[index + 1] * height;
  }
}

function rebuildTargetBuffer() {
  writeTargetPositions();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.targets);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.targets);
}

function uploadParticleBuffers(positions, velocities) {
  const vectorBytes = positions.byteLength;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positions[0]);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_COPY);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positions[1]);
  gl.bufferData(gl.ARRAY_BUFFER, vectorBytes, gl.DYNAMIC_COPY);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.velocities[0]);
  gl.bufferData(gl.ARRAY_BUFFER, velocities, gl.DYNAMIC_COPY);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.velocities[1]);
  gl.bufferData(gl.ARRAY_BUFFER, vectorBytes, gl.DYNAMIC_COPY);

  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.targets);
  gl.bufferData(gl.ARRAY_BUFFER, state.targets, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.colors);
  gl.bufferData(gl.ARRAY_BUFFER, state.colors, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.seeds);
  gl.bufferData(gl.ARRAY_BUFFER, state.seeds, gl.STATIC_DRAW);
}

function scatterParticles() {
  if (!state.initialized) return;
  const count = state.count;
  const positions = new Float32Array(count * 2);
  const velocities = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    const seed = fract(Math.sin(state.seeds[i] * 23.37) * 43758.5453);
    const angle = seed * Math.PI * 2 + i * 2.39996323;
    const radius = 1.18 + fract(seed * 91.17) * 0.9;
    const index = i * 2;
    positions[index] = Math.cos(angle) * radius;
    positions[index + 1] = Math.sin(angle) * radius;
    velocities[index] = Math.cos(angle + 0.8) * 0.26;
    velocities[index + 1] = Math.sin(angle - 0.2) * 0.26;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positions[state.current]);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.velocities[state.current]);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, velocities);
}

function tick(now) {
  const dt = Math.min(0.033, Math.max(0.001, (now - lastTime) / 1000));
  lastTime = now;
  state.mouse.dx *= 0.88;
  state.mouse.dy *= 0.88;
  state.mouse.strength *= 0.94;
  resizeCanvas();
  if (state.initialized) {
    if (!state.paused) {
      updateParticles(now * 0.001, dt);
    }
    render(now * 0.001);
  }
  renderBrandParticles(now * 0.001, dt);
  updateFps(now);
  animationId = requestAnimationFrame(tick);
}

function updateParticles(time, dt) {
  const src = state.current;
  const dst = 1 - src;
  const program = programs.update;
  gl.useProgram(program.program);
  bindParticleAttributes(program, src, 0);
  setCommonUpdateUniforms(program, time, dt);

  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, buffers.transformFeedback);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buffers.positions[dst]);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, buffers.velocities[dst]);
  gl.enable(gl.RASTERIZER_DISCARD);
  gl.beginTransformFeedback(gl.POINTS);
  gl.drawArrays(gl.POINTS, 0, state.count);
  gl.endTransformFeedback();
  gl.disable(gl.RASTERIZER_DISCARD);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
  gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
  gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
  state.current = dst;
}

function setCommonUpdateUniforms(program, time, dt) {
  gl.uniform1f(program.uniforms.u_time, time);
  gl.uniform1f(program.uniforms.u_dt, dt);
  gl.uniform1i(program.uniforms.u_mode, state.mode);
  gl.uniform1f(program.uniforms.u_speed, state.speed);
  gl.uniform1f(program.uniforms.u_energy, state.energy);
  gl.uniform2f(program.uniforms.u_mouse, state.mouse.x, state.mouse.y);
  gl.uniform1f(program.uniforms.u_mouseActive, state.mouse.active);
  gl.uniform2f(program.uniforms.u_mouseVelocity, state.mouse.dx, state.mouse.dy);
  gl.uniform1f(program.uniforms.u_mouseStrength, state.mouse.strength);
}

function render(time) {
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0.028, 0.031, 0.024, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);

  if (state.mode === 1 || state.mode === 2 || state.mode === 6 || state.mode === 7 || state.mode === 8) {
    drawLines(time);
  }

  drawPoints(time);
}

function drawPoints(time) {
  const program = programs.point;
  gl.useProgram(program.program);
  bindParticleAttributes(program, state.current, 0);
  gl.uniform1i(program.uniforms.u_mode, state.mode);
  gl.uniform1f(program.uniforms.u_time, time);
  gl.uniform1f(program.uniforms.u_particleScale, state.particleScale);
  gl.uniform1f(program.uniforms.u_energy, state.energy);
  gl.uniform1f(program.uniforms.u_maxPointSize, pointSizeLimit[1]);
  gl.uniform2f(program.uniforms.u_mouse, state.mouse.x, state.mouse.y);
  gl.uniform1f(program.uniforms.u_mouseActive, state.mouse.active);
  gl.uniform1f(program.uniforms.u_mouseStrength, state.mouse.strength);
  if (state.mode === 2 || state.mode === 3 || state.mode === 7 || state.mode === 8) {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  } else {
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  gl.drawArrays(gl.POINTS, 0, state.count);
}

function drawLines(time) {
  const program = programs.line;
  const instances = Math.min(
    state.count,
    Math.floor(240000 * Math.max(0.08, state.lineDensity)),
  );
  if (instances <= 0) return;
  gl.useProgram(program.program);
  bindGeometryAttribute(program, "a_endpoint", geometry.lineEndpoints, 1, 0);
  bindParticleAttributes(program, state.current, 1);
  gl.uniform1i(program.uniforms.u_mode, state.mode);
  gl.uniform1f(program.uniforms.u_time, time);
  gl.uniform1f(program.uniforms.u_lineScale, state.lineDensity);
  gl.uniform2f(program.uniforms.u_mouse, state.mouse.x, state.mouse.y);
  gl.uniform1f(program.uniforms.u_mouseStrength, state.mouse.strength);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.drawArraysInstanced(gl.LINES, 0, 2, instances);
  resetDivisors(program);
}

function drawStrokes(time) {
  const program = programs.stroke;
  const modeLimit = state.mode === 7 ? 190000 : 130000;
  const instances = Math.min(state.count, Math.floor(modeLimit * Math.max(0.18, state.lineDensity)));
  if (instances <= 0) return;
  gl.useProgram(program.program);
  bindGeometryAttribute(program, "a_corner", geometry.quadCorners, 2, 0);
  bindParticleAttributes(program, state.current, 1);
  gl.uniform1i(program.uniforms.u_mode, state.mode);
  gl.uniform1f(program.uniforms.u_time, time);
  gl.uniform1f(program.uniforms.u_particleScale, state.particleScale);
  gl.uniform1f(program.uniforms.u_lineScale, state.lineDensity);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);
  resetDivisors(program);
}

function bindParticleAttributes(program, bufferIndex, divisor) {
  bindBufferAttribute(program, "a_position", buffers.positions[bufferIndex], 2, divisor);
  bindBufferAttribute(program, "a_velocity", buffers.velocities[bufferIndex], 2, divisor);
  bindBufferAttribute(program, "a_target", buffers.targets, 2, divisor);
  bindBufferAttribute(program, "a_color", buffers.colors, 4, divisor);
  bindBufferAttribute(program, "a_seed", buffers.seeds, 1, divisor);
}

function bindGeometryAttribute(program, name, buffer, size, divisor) {
  bindBufferAttribute(program, name, buffer, size, divisor);
}

function bindBufferAttribute(program, name, buffer, size, divisor) {
  const location = program.attributes[name];
  if (location === undefined || location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(location, divisor);
}

function resetDivisors(program) {
  Object.values(program.attributes).forEach((location) => {
    if (location >= 0) {
      gl.vertexAttribDivisor(location, 0);
    }
  });
}

function updateFps(now) {
  fpsFrames += 1;
  if (now - fpsTime > 500) {
    const fps = (fpsFrames * 1000) / (now - fpsTime);
    fpsStatus.textContent = `${Math.round(fps)} fps`;
    fpsTime = now;
    fpsFrames = 0;
  }
}

function formatCount(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  return `${Math.round(value / 1000)}K`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x;
}

function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fract(value) {
  return value - Math.floor(value);
}

const UPDATE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_velocity;
in vec2 a_target;
in vec4 a_color;
in float a_seed;

uniform float u_time;
uniform float u_dt;
uniform int u_mode;
uniform float u_speed;
uniform float u_energy;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform vec2 u_mouseVelocity;
uniform float u_mouseStrength;

out vec2 v_position;
out vec2 v_velocity;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i.x + i.y * 57.0);
  float b = hash(i.x + 1.0 + i.y * 57.0);
  float c = hash(i.x + (i.y + 1.0) * 57.0);
  float d = hash(i.x + 1.0 + (i.y + 1.0) * 57.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 curl(vec2 p) {
  float e = 0.05;
  float n1 = noise(p + vec2(0.0, e));
  float n2 = noise(p - vec2(0.0, e));
  float n3 = noise(p + vec2(e, 0.0));
  float n4 = noise(p - vec2(e, 0.0));
  return vec2(n1 - n2, n4 - n3) / (2.0 * e);
}

void main() {
  vec2 pos = a_position;
  vec2 vel = a_velocity;
  vec2 toTarget = a_target - pos;
  float dist = length(toTarget) + 0.0001;
  vec2 dir = toTarget / dist;
  vec2 tangent = vec2(-dir.y, dir.x);
  float lum = dot(a_color.rgb, vec3(0.299, 0.587, 0.114));
  float seed = a_seed;
  float wave = sin(u_time * (0.8 + hash(seed + 4.0) * 2.4) + seed * 8.0 + dist * 7.0);
  vec2 flow = curl(pos * (2.2 + hash(seed) * 3.0) + u_time * 0.08);

  float spring = 1.55 + lum * 2.4;
  float damping = 0.82;
  vec2 accel = toTarget * spring + tangent * wave * u_energy * 0.18 + flow * u_energy * 0.22;

  if (u_mode == 1) {
    damping = 0.9;
    accel += tangent * sin(seed * 31.0 + u_time * 1.5) * 0.16 * u_energy;
    accel += dir * 0.6;
  } else if (u_mode == 2) {
    damping = 0.9;
    float pull = clamp(max(u_mouseActive, u_mouseStrength), 0.0, 1.0);
    vec2 autoWell = vec2(sin(u_time * 0.31), cos(u_time * 0.27)) * 0.42;
    vec2 well = mix(autoWell, u_mouse, pull);
    vec2 toWell = well - pos;
    float wellDist = length(toWell) + 0.0001;
    float field = smoothstep(0.92, 0.0, wellDist);
    vec2 wellDir = toWell / wellDist;
    vec2 wellTangent = vec2(-wellDir.y, wellDir.x);
    float spin = 1.0 + hash(seed + 12.0) * 1.8 + u_energy;
    accel += wellDir * field * (1.4 + pull * 2.4);
    accel += wellTangent * field * spin * (0.65 + u_mouseStrength);
    accel += toTarget * (0.95 + field * 0.55);
  } else if (u_mode == 3) {
    damping = 0.88;
    accel = toTarget * (0.82 + lum) + flow * (0.9 + u_energy) + tangent * wave * 0.22;
  } else if (u_mode == 4) {
    damping = 0.78;
    accel += vec2(sin(seed * 19.0 + u_time * 2.0) * 0.08, -0.95);
    accel += dir * smoothstep(0.35, 0.0, dist) * 1.5;
  } else if (u_mode == 5) {
    damping = 0.86;
    float intent = clamp(max(u_mouseActive, u_mouseStrength), 0.0, 1.0);
    vec2 probe = mix(vec2(sin(u_time * 0.37) * 0.55, cos(u_time * 0.29) * 0.38), u_mouse, intent);
    float reveal = smoothstep(0.72, 0.0, length(pos - probe));
    accel += toTarget * (0.45 + reveal * 3.0);
    accel += flow * (0.55 + (1.0 - reveal) * u_energy * 0.9);
    accel += normalize(probe - pos + 0.0001) * reveal * 0.35;
  } else if (u_mode == 6) {
    damping = 0.86;
    vec2 center = vec2(sin(u_time * 0.23), cos(u_time * 0.19)) * 0.22;
    vec2 toCenter = center - pos;
    accel += normalize(toCenter + 0.0001) * 0.16 + tangent * (0.75 + lum) * u_energy;
  } else if (u_mode == 7) {
    damping = 0.89;
    float drag = clamp(max(u_mouseActive, u_mouseStrength), 0.0, 1.0);
    vec2 center = mix(vec2(sin(u_time * 0.25) * 0.34, cos(u_time * 0.21) * 0.26), u_mouse, drag);
    vec2 radial = pos - center;
    float radialDist = length(radial) + 0.0001;
    vec2 orbit = vec2(-radial.y, radial.x) / radialDist;
    vec2 trail = normalize(u_mouseVelocity * 16.0 + orbit + 0.0001);
    float band = smoothstep(0.95, 0.0, radialDist);
    accel += orbit * band * (1.1 + u_energy + drag);
    accel += trail * band * u_mouseStrength * 2.2;
    accel += toTarget * (0.95 + (1.0 - band) * 0.8);
  } else if (u_mode == 8) {
    damping = 0.84;
    float field = sin(pos.x * 9.0 + u_time * 1.2) + cos(pos.y * 7.0 - u_time * 0.8);
    vec2 magnetic = normalize(vec2(cos(field), sin(field)));
    accel += magnetic * 0.42 * u_energy + tangent * 0.22;
  } else if (u_mode == 9) {
    damping = 0.76;
    float growth = smoothstep(0.0, 1.0, fract(u_time * 0.08 + hash(seed)));
    vec2 fromCenter = normalize(a_target + 0.0001);
    accel += fromCenter * (growth - dist) * 0.7;
    accel += toTarget * 1.25;
  }

  vec2 toMouse = pos - u_mouse;
  float mouseDist = length(toMouse) + 0.0001;
  float pointerIntent = clamp(max(u_mouseActive, u_mouseStrength), 0.0, 1.0);
  float mouseField = smoothstep(0.48, 0.0, mouseDist) * pointerIntent;
  if (u_mode == 2) {
    accel += normalize(-toMouse) * mouseField * 2.0;
    accel += vec2(-toMouse.y, toMouse.x) * mouseField * (1.1 + u_mouseStrength);
  } else if (u_mode == 5) {
    accel += dir * mouseField * 2.2;
    accel += normalize(-toMouse) * mouseField * 0.45;
  } else if (u_mode == 7) {
    accel += vec2(-toMouse.y, toMouse.x) * mouseField * (2.4 + u_mouseStrength);
    accel += u_mouseVelocity * mouseField * 12.0;
  } else {
    accel += normalize(toMouse) * mouseField * 2.25;
    accel += vec2(-toMouse.y, toMouse.x) * mouseField * 0.75;
  }

  vel += accel * u_dt * u_speed;
  vel *= pow(damping, u_dt * 60.0);
  pos += vel * u_dt * (0.82 + u_speed * 0.4);

  if (abs(pos.x) > 2.6 || abs(pos.y) > 2.6) {
    float a = hash(seed + u_time) * 6.2831853;
    pos = vec2(cos(a), sin(a)) * 1.4;
    vel *= 0.1;
  }

  v_position = pos;
  v_velocity = vel;
}
`;

const PASSTHROUGH_FRAGMENT_SHADER = `#version 300 es
precision highp float;
out vec4 fragColor;
void main() {
  fragColor = vec4(0.0);
}
`;

const POINT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_velocity;
in vec2 a_target;
in vec4 a_color;
in float a_seed;

uniform int u_mode;
uniform float u_time;
uniform float u_particleScale;
uniform float u_energy;
uniform float u_maxPointSize;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_mouseStrength;

out vec4 v_color;
out float v_seed;
out float v_modeMix;
out float v_speed;
out float v_interaction;

void main() {
  float speed = length(a_velocity);
  float drift = length(a_target - a_position);
  float pulse = 0.5 + 0.5 * sin(u_time * 1.7 + a_seed * 9.0);
  float intent = clamp(max(u_mouseActive, u_mouseStrength), 0.0, 1.0);
  vec2 probe = mix(vec2(sin(u_time * 0.37) * 0.55, cos(u_time * 0.29) * 0.38), u_mouse, intent);
  float interaction = smoothstep(0.78, 0.0, length(a_position - probe));
  float size = u_particleScale * (1.2 + pulse * 0.35 + speed * 2.2);

  if (u_mode == 2) {
    size *= 1.2 + interaction * 2.1;
  } else if (u_mode == 3) {
    size *= 3.0 + u_energy * 2.2;
  } else if (u_mode == 4) {
    size *= 0.72;
  } else if (u_mode == 5) {
    size *= 0.65 + interaction * 2.4;
  } else if (u_mode == 7) {
    size *= 0.9 + speed * 3.8 + interaction * 0.8;
  } else if (u_mode == 9) {
    size *= 1.7 + smoothstep(0.5, 0.0, drift);
  }

  gl_Position = vec4(a_position, 0.0, 1.0);
  gl_PointSize = min(u_maxPointSize, max(1.0, size));
  v_color = a_color;
  v_seed = a_seed;
  v_modeMix = float(u_mode);
  v_speed = speed;
  v_interaction = interaction;
}
`;

const POINT_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
in float v_seed;
in float v_modeMix;
in float v_speed;
in float v_interaction;
out vec4 fragColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  vec2 uv = gl_PointCoord * 2.0 - 1.0;
  float d = length(uv);
  float mode = v_modeMix;
  float alpha = smoothstep(1.0, 0.12, d);
  vec3 color = pow(max(v_color.rgb, vec3(0.0)), vec3(1.0 / 2.2));

  if (mode == 2.0) {
    float core = exp(-d * d * 3.8);
    float rim = smoothstep(0.72, 0.5, d) - smoothstep(0.98, 0.78, d);
    alpha = max(alpha * 0.38, core * (0.2 + v_interaction * 0.68) + rim * v_interaction * 0.5);
    color = mix(color, vec3(0.45, 1.0, 0.86), v_interaction * 0.42);
  } else if (mode == 3.0) {
    alpha = exp(-d * d * 2.4) * 0.13;
    color *= 1.25;
  } else if (mode == 4.0) {
    alpha = step(max(abs(uv.x), abs(uv.y)), 0.72) * 0.82;
    color *= 0.9 + hash(v_seed) * 0.22;
  } else if (mode == 5.0) {
    float glow = exp(-d * d * 2.8);
    alpha = glow * (0.05 + v_interaction * 0.92);
    color = mix(color * 0.16, color * 1.38 + vec3(0.12, 0.16, 0.08), v_interaction);
  } else if (mode == 7.0) {
    float filament = smoothstep(1.0, 0.02, abs(uv.y * 0.35 + uv.x * 0.04));
    alpha = max(alpha * 0.34, filament * (0.12 + v_speed * 2.4 + v_interaction * 0.35));
    color = mix(color, vec3(0.38, 0.95, 1.0), 0.18 + v_interaction * 0.28);
  } else if (mode == 8.0) {
    alpha = smoothstep(1.0, 0.02, abs(uv.y * 0.28 + uv.x * 0.05)) * smoothstep(1.0, 0.1, d) * 0.28;
  } else if (mode == 9.0) {
    float ring = smoothstep(0.82, 0.52, d) - smoothstep(0.96, 0.82, d);
    alpha = max(alpha * 0.58, ring * 0.72);
    color = mix(color, vec3(0.9, 1.0, 0.76), ring * 0.2);
  }

  alpha *= v_color.a * (0.78 + min(0.35, v_speed));
  if (alpha <= 0.002) discard;
  fragColor = vec4(color, alpha);
}
`;

const LINE_VERTEX_SHADER = `#version 300 es
precision highp float;

in float a_endpoint;
in vec2 a_position;
in vec2 a_velocity;
in vec2 a_target;
in vec4 a_color;
in float a_seed;

uniform int u_mode;
uniform float u_time;
uniform float u_lineScale;
uniform vec2 u_mouse;
uniform float u_mouseStrength;

out vec4 v_color;

void main() {
  vec2 start = a_position;
  vec2 end = a_target;

  if (u_mode == 2) {
    vec2 center = mix(vec2(0.0), u_mouse, clamp(u_mouseStrength * 1.4, 0.0, 1.0));
    vec2 radial = a_position - center;
    vec2 tangent = normalize(vec2(-radial.y, radial.x) + a_velocity * 2.0 + 0.0001);
    float len = 0.018 + u_lineScale * 0.08 + u_mouseStrength * 0.05;
    start = a_position - tangent * len;
    end = a_position + tangent * len;
  } else if (u_mode == 6) {
    vec2 tangent = normalize(vec2(-a_velocity.y, a_velocity.x) + 0.0001);
    end = a_position + tangent * (0.03 + u_lineScale * 0.09);
    start = a_position - tangent * 0.02;
  } else if (u_mode == 7) {
    vec2 center = mix(vec2(0.0), u_mouse, clamp(u_mouseStrength * 1.5, 0.0, 1.0));
    vec2 radial = a_position - center;
    vec2 ribbon = normalize(a_velocity + vec2(-radial.y, radial.x) * 0.75 + 0.0001);
    float len = 0.024 + length(a_velocity) * 0.2 + u_lineScale * 0.075;
    start = a_position - ribbon * len;
    end = a_position + ribbon * len;
  } else if (u_mode == 8) {
    float field = sin(a_position.x * 10.0 + u_time * 1.2) + cos(a_position.y * 8.0 - u_time);
    vec2 magnetic = normalize(vec2(cos(field), sin(field)));
    float len = 0.018 + u_lineScale * 0.105;
    start = a_position - magnetic * len;
    end = a_position + magnetic * len;
  }

  vec2 pos = mix(start, end, a_endpoint);
  gl_Position = vec4(pos, 0.0, 1.0);
  float fade = 1.0 - a_endpoint * 0.32;
  v_color = vec4(pow(max(a_color.rgb, vec3(0.0)), vec3(1.0 / 2.2)), a_color.a * fade);
}
`;

const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec4 v_color;
out vec4 fragColor;

void main() {
  fragColor = vec4(v_color.rgb, v_color.a * 0.16);
}
`;

const STROKE_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_corner;
in vec2 a_position;
in vec2 a_velocity;
in vec2 a_target;
in vec4 a_color;
in float a_seed;

uniform int u_mode;
uniform float u_time;
uniform float u_particleScale;
uniform float u_lineScale;

out vec2 v_corner;
out vec4 v_color;
out float v_mode;
out float v_seed;

mat2 rotate2d(float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 direction = normalize(a_velocity + (a_target - a_position) * 0.35 + 0.0001);
  float angle = atan(direction.y, direction.x);
  float speed = length(a_velocity);
  float width = 0.0045 * u_particleScale;
  float lengthScale = 0.026 + speed * 0.09 + u_lineScale * 0.04;

  if (u_mode == 2) {
    angle = floor((angle + a_seed) * 2.0) * 0.785398;
    width *= 3.8;
    lengthScale *= 1.8;
  } else if (u_mode == 5) {
    angle += sin(a_seed * 17.0 + u_time) * 0.7;
    width *= 2.8;
    lengthScale *= 2.6;
  } else if (u_mode == 7) {
    width *= 2.4;
    lengthScale *= 3.4;
  }

  vec2 local = vec2(a_corner.x * lengthScale, a_corner.y * width);
  vec2 pos = a_position + rotate2d(angle) * local;
  gl_Position = vec4(pos, 0.0, 1.0);
  v_corner = a_corner;
  v_color = vec4(pow(max(a_color.rgb, vec3(0.0)), vec3(1.0 / 2.2)), a_color.a);
  v_mode = float(u_mode);
  v_seed = a_seed;
}
`;

const STROKE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_corner;
in vec4 v_color;
in float v_mode;
in float v_seed;
out vec4 fragColor;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  vec2 uv = v_corner * 2.0;
  float edge = smoothstep(1.0, 0.72, abs(uv.y)) * smoothstep(1.0, 0.5, abs(uv.x));
  vec3 color = v_color.rgb;
  float alpha = edge * 0.34;

  if (v_mode == 2.0) {
    alpha = step(max(abs(uv.x), abs(uv.y)), 0.98) * 0.24;
    color *= 0.95 + hash(v_seed) * 0.12;
  } else if (v_mode == 5.0) {
    float diagonal = step(abs(uv.x + uv.y * 0.45), 1.15);
    alpha = diagonal * edge * 0.28;
    color = mix(color, vec3(0.82, 1.0, 0.96), 0.22);
  } else if (v_mode == 7.0) {
    alpha = edge * (0.22 + hash(v_seed) * 0.26);
    color *= 1.05;
  }

  if (alpha <= 0.002) discard;
  fragColor = vec4(color, alpha * v_color.a);
}
`;

if (!gl) {
  unsupportedMessage.hidden = false;
  rendererStatus.textContent = "WebGL2 unavailable";
} else {
  boot();
}
