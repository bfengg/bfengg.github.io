import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  EdgesGeometry,
  FloatType,
  FrontSide,
  Fog,
  Group,
  IcosahedronGeometry,
  LineBasicNodeMaterial,
  LineSegments,
  Line,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RenderPipeline,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SpriteNodeMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  Vector4,
  WebGPURenderer,
} from "three/webgpu";
import {
  Fn,
  PI,
  abs,
  cameraPosition,
  distance,
  dot,
  exp,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  int,
  ivec2,
  luminance,
  max,
  min,
  mix,
  mod,
  mx_noise_vec3,
  normalView,
  normalize,
  pass,
  positionLocal,
  positionViewDirection,
  positionWorld,
  screenUV,
  sin,
  smoothstep,
  step,
  textureLoad,
  time,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { chromaticAberration } from "three/addons/tsl/display/ChromaticAberrationNode.js";
import { film } from "three/addons/tsl/display/FilmNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CHAPTERS,
  DOMAINS,
  DURATION,
  HOSTS,
  JOURNEY_FAILS,
  KILLS,
  NODES,
  PATHS,
  PODS,
  QUEUE,
  RUNS_ON,
  podCenter,
  stateAt,
} from "./scenario";

const SAMPLES = 512;
const PER_PATH = 700;
const QUEUE_PARTICLES = 1600;
const MOTES = 16384;
const DEBRIS = 900;
const CACHE_SLOTS = 125;
const AMBER = new Color("#f59e0b");
const RED = new Color("#ef4444");
const CODE = new Color("#fde68a");
const LAYER_COLOR = { journey: new Color("#f2f2ed"), service: new Color("#a3e635"), infra: new Color("#7dd3fc") };

/* What each lens keeps in focus. Everything else drops to a ghost, so switching lens reads as a different view. */
const LENSES = {
  all: { journey: 1, service: 1, infra: 1, code: 0.3, ribbons: 0.45, particles: 1, tint: [1, 1, 1], sat: 1 },
  journey: { journey: 1, service: 0.04, infra: 0.025, code: 0, ribbons: 1, particles: 0.9, tint: [1.08, 1.0, 0.9], sat: 1.15 },
  code: { journey: 0.1, service: 1, infra: 0.08, code: 1, ribbons: 0.2, particles: 0.55, tint: [1.12, 1.02, 0.78], sat: 0.85 },
  infra: { journey: 0.025, service: 0.05, infra: 1, code: 0, ribbons: 0.03, particles: 0.45, tint: [0.82, 1.0, 1.16], sat: 0.9 },
};

/* healthy → amber → red */
function healthColor(base, h, out = new Color()) {
  if (h < 0.5) return out.copy(base).lerp(AMBER, h * 2);
  return out.copy(AMBER).lerp(RED, (h - 0.5) * 2);
}
const v3 = (p) => new Vector3(p[0], p[1], p[2]);
const curveOf = (points) => new CatmullRomCurve3(points.map(v3), false, "centripetal", 0.5);
const smooth = (k) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};
const clamp01 = (k) => Math.min(1, Math.max(0, k));

/* Things fade as the camera reaches them, so flying through a service never slams into its surface. */
const nearFade = (from) => smoothstep(from, from + 0.9, distance(positionWorld, cameraPosition));

/* A flat glowing material: `alarm` (0..1) makes it throb faster and brighter, `fade` is its lens. */
function glow({ opacity = 1, fresnel = false, near = 0.3, side = FrontSide } = {}) {
  const color = uniform(new Color());
  const alarm = uniform(0);
  const fade = uniform(1);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side });
  const pulse = sin(time.mul(alarm.mul(9).add(1.2))).mul(0.5).add(0.5);
  material.colorNode = color.mul(float(1).add(pulse.mul(alarm).mul(0.8)));
  const rim = fresnel ? float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2.2).mul(0.42).add(0.015) : float(1);
  material.opacityNode = rim.mul(opacity).mul(fade).mul(nearFade(near));
  return { material, color, alarm, fade };
}
function lineGlow(opacity = 1) {
  const color = uniform(new Color());
  const fade = uniform(1);
  const material = new LineBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.colorNode = color;
  material.opacityNode = fade.mul(opacity);
  return { material, color, fade };
}

/* Maps 0..1 of a shot's time to 0..1 along a curve, slowing down near `stops` so the camera lingers inside services. */
function makeDwell(curve, stops, linger = 3) {
  const n = 800;
  const cumulative = [0];
  for (let i = 1; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const d = Math.min(...stops.map((s) => s.distanceTo(p)));
    cumulative.push(cumulative[i - 1] + 1 + linger * Math.exp(-(d * d) / 0.3));
  }
  const total = cumulative[n];
  return (k) => {
    const target = clamp01(k) * total;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = cumulative[hi] - cumulative[lo] || 1;
    return (lo + (target - cumulative[lo]) / span) / n;
  };
}
function closestU(curve, point) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i <= 1000; i++) {
    const d = curve.getPointAt(i / 1000).distanceToSquared(point);
    if (d < bestD) {
      bestD = d;
      best = i / 1000;
    }
  }
  return best;
}

export async function createEngine({ canvas, stage, labelRefs, onTick }) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
  try {
    await renderer.init();
  } catch (error) {
    return null;
  }
  const backend = renderer.backend?.isWebGPUBackend ? "WebGPU" : "WebGL 2";
  renderer.setClearColor("#05070a", 1);

  const scene = new Scene();
  scene.background = new Color("#05070a");
  scene.fog = new Fog("#05070a", 20, 52);
  const camera = new PerspectiveCamera(45, 1, 0.03, 200);
  camera.position.set(30, 16, 30);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enabled = false;

  /* ---------- post: bloom, chromatic aberration on impacts, lens grade, scan wipe, vignette, grain ---------- */
  const fx = {
    chroma: uniform(0),
    flash: uniform(0),
    tint: uniform(new Vector3(1, 1, 1)),
    sat: uniform(1),
    wipe: uniform(-1),
    wipeColor: uniform(new Color("#a3e635")),
  };
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const bloomPass = bloom(sceneColor, 0.55, 0.4, 0.32);
  const aberrated = chromaticAberration(sceneColor.add(bloomPass), fx.chroma, vec2(0.5, 0.5), 1.12);
  const graded = mix(vec3(luminance(aberrated.rgb)), aberrated.rgb, fx.sat).mul(fx.tint);
  const vignette = mix(float(1), smoothstep(0.95, 0.2, screenUV.sub(0.5).length()), 0.6);
  const scan = smoothstep(0.005, 0.0, abs(screenUV.y.sub(fx.wipe)));
  const lit = graded.mul(vignette).add(fx.wipeColor.mul(scan).mul(0.55)).add(vec3(fx.flash));
  pipeline.outputNode = film(vec4(lit, 1), float(0.22));

  /* Strata are groups so the prologue can assemble them. */
  const strata = { journey: new Group(), service: new Group(), infra: new Group(), links: new Group() };
  Object.values(strata).forEach((g) => scene.add(g));
  const fade = Object.fromEntries(["journey", "service", "infra", "code", "ribbons", "particles", "links"].map((k) => [k, uniform(1)]));
  const disposables = [];
  const keep = (...items) => {
    disposables.push(...items);
    return items[0];
  };

  /* ---------- ambient motes: a GPU compute field, pushed outward by every crash ---------- */
  const shock = uniform(new Vector4(0, 0, 0, 0));
  let motesUpdate = null;
  try {
    const box = vec3(44, 26, 40);
    const positions = instancedArray(MOTES, "vec3");
    const velocities = instancedArray(MOTES, "vec3");
    const init = Fn(() => {
      positions
        .element(instanceIndex)
        .assign(vec3(hash(instanceIndex), hash(instanceIndex.add(1)), hash(instanceIndex.add(2))).sub(0.5).mul(box));
    })().compute(MOTES);
    motesUpdate = Fn(() => {
      const p = positions.element(instanceIndex);
      const v = velocities.element(instanceIndex);
      const drift = mx_noise_vec3(p.mul(0.07).add(vec3(0, time.mul(0.04), 0)));
      v.addAssign(drift.mul(0.0012));
      const away = p.sub(shock.xyz);
      const d = max(away.length(), float(0.6));
      v.addAssign(normalize(away).mul(shock.w).div(d.mul(d)).mul(0.05));
      v.mulAssign(0.965);
      p.addAssign(v);
      p.assign(mod(p.add(box.mul(0.5)), box).sub(box.mul(0.5)));
    })().compute(MOTES);
    await renderer.computeAsync(init);
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    material.positionNode = positions.toAttribute();
    const seed = hash(instanceIndex.add(3));
    material.scaleNode = seed.mul(0.03).add(0.012);
    material.colorNode = mix(vec3(0.45, 0.7, 0.75), vec3(0.85, 0.95, 0.7), seed);
    material.opacityNode = smoothstep(0.5, 0.0, uv().sub(0.5).length()).mul(0.45).mul(nearFade(0.1));
    const motes = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    motes.count = MOTES;
    motes.frustumCulled = false;
    scene.add(motes);
  } catch (error) {
    motesUpdate = null;
  }

  /* ---------- domains: fresnel bubbles with a slow lattice ---------- */
  const domains = DOMAINS.map((spec) => {
    const base = new Color(spec.color);
    const shell = glow({ fresnel: true, near: 0.4 });
    const bubble = new Mesh(keep(new SphereGeometry(spec.r, 48, 32)), keep(shell.material));
    bubble.position.set(...spec.center);
    const wire = glow({ opacity: 0.05 });
    wire.material.wireframe = true;
    const lattice = new Mesh(keep(new IcosahedronGeometry(spec.r * 1.02, 2)), keep(wire.material));
    bubble.add(lattice);
    strata.service.add(bubble);
    return { spec, base, lattice, uniforms: [shell, wire] };
  });

  /* ---------- journeys, services, Temporal, Postgres ---------- */
  const nodes = NODES.map((spec) => {
    const g = glow({ near: 0.5 });
    let geometry;
    if (spec.kind === "journey") geometry = new TorusGeometry(0.62, 0.06, 12, 64);
    else if (spec.kind === "workflow") geometry = new OctahedronGeometry(0.42);
    else if (spec.kind === "temporal") geometry = new IcosahedronGeometry(0.42, 0);
    else if (spec.kind === "db") geometry = new CylinderGeometry(0.75, 0.75, 1.1, 32, 1, true);
    else geometry = new IcosahedronGeometry(0.3, 1);
    const mesh = new Mesh(keep(geometry), keep(g.material));
    mesh.position.set(...spec.pos);
    strata[spec.layer].add(mesh);
    const parts = [g];
    if (spec.kind === "journey") {
      const core = new Mesh(keep(new SphereGeometry(0.16, 16, 12)), g.material);
      core.position.copy(mesh.position);
      strata.journey.add(core);
      const halo = glow({ opacity: 0.35 });
      const ring = new Mesh(keep(new TorusGeometry(1.0, 0.012, 8, 96)), keep(halo.material));
      ring.position.copy(mesh.position);
      ring.rotation.x = Math.PI / 2;
      strata.journey.add(ring);
      parts.push(halo);
    }
    if (spec.kind === "db") {
      const caps = glow({ opacity: 0.5 });
      caps.material.wireframe = true;
      mesh.add(new Mesh(keep(new CylinderGeometry(0.75, 0.75, 1.1, 32, 3)), keep(caps.material)));
      parts.push(caps);
    }
    return { spec, mesh, parts, base: LAYER_COLOR[spec.layer] };
  });
  const nodeById = Object.fromEntries(nodes.map((n) => [n.spec.id, n]));

  /* ---------- hosts and pods ---------- */
  const hosts = HOSTS.map((spec) => {
    const box = new BoxGeometry(...spec.size);
    const edges = lineGlow(0.7);
    const outline = new LineSegments(keep(new EdgesGeometry(box)), keep(edges.material));
    const fillGlow = glow({ opacity: 0.03 });
    const fill = new Mesh(keep(box), keep(fillGlow.material));
    outline.position.set(...spec.center);
    fill.position.set(...spec.center);
    strata.infra.add(outline, fill);
    return { spec, edges, fillGlow };
  });

  /* A grid wall for pods, readable from inside. */
  function gridWall() {
    const g = glow({ near: 0.02, side: DoubleSide });
    const cell = uv().mul(6);
    const line = max(smoothstep(0.975, 1, abs(sin(cell.x.mul(PI)))), smoothstep(0.975, 1, abs(sin(cell.y.mul(PI)))));
    g.material.opacityNode = line.mul(0.22).add(0.025).mul(g.fade).mul(nearFade(0.02));
    return g;
  }
  const pods = PODS.map((spec) => {
    const center = new Vector3(...podCenter(spec.id));
    const group = new Group();
    group.position.copy(center);
    const shellBox = new BoxGeometry(0.72, 0.72, 0.72);
    const edges = lineGlow(0.9);
    group.add(new LineSegments(keep(new EdgesGeometry(shellBox)), keep(edges.material)));
    const walls = gridWall();
    group.add(new Mesh(keep(shellBox), keep(walls.material)));
    // Memory: a liquid that rises in the pod, with a rippling surface.
    const gauge = glow({ opacity: 0.32, near: 0.02, side: DoubleSide });
    const surface = step(0.49, positionLocal.y);
    gauge.material.positionNode = positionLocal.add(
      vec3(0, sin(positionLocal.x.mul(18).add(time.mul(3))).mul(sin(positionLocal.z.mul(14).add(time.mul(2.2)))).mul(0.04).mul(surface), 0)
    );
    const fill = new Mesh(keep(new BoxGeometry(0.64, 1, 0.64, 10, 1, 10)), keep(gauge.material));
    group.add(fill);
    const burstGlow = glow({ opacity: 1 });
    const burst = new Mesh(keep(new TorusGeometry(0.5, 0.025, 8, 48)), keep(burstGlow.material));
    burst.rotation.x = Math.PI / 2;
    group.add(burst);
    const pod = { spec, center, group, edges, walls, gauge, fill, burst, burstGlow, cache: null, debris: null };
    if (spec.service === "worker") {
      // The receipt cache: PDFs stacking up as memory grows.
      const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const shown = uniform(0);
      const fi = instanceIndex.toFloat();
      const slot = vec3(mod(fi, 5), floor(fi.div(25)), mod(floor(fi.div(5)), 5));
      material.positionNode = positionLocal.add(slot.mul(0.12).sub(vec3(0.24, 0.3, 0.24)));
      material.colorNode = vec3(0.75, 0.5, 0.18);
      material.opacityNode = step(fi, shown).mul(0.22).mul(fade.infra).mul(nearFade(0.14));
      const cache = new Mesh(keep(new BoxGeometry(0.085, 0.085, 0.085)), keep(material));
      cache.count = CACHE_SLOTS;
      cache.frustumCulled = false;
      group.add(cache);
      pod.cache = { mesh: cache, shown };
    }
    if (spec.fate === "oom") {
      // Debris: a deterministic burst, so scrubbing the timeline replays it exactly.
      const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
      const age = uniform(-1);
      const dir = normalize(vec3(hash(instanceIndex), hash(instanceIndex.add(9)), hash(instanceIndex.add(21))).sub(0.5));
      const speed = hash(instanceIndex.add(33)).mul(3.5).add(0.6);
      const travel = float(1).sub(exp(age.mul(-2.2)));
      material.positionNode = vec3(...center.toArray())
        .add(dir.mul(speed).mul(travel))
        .add(vec3(0, age.mul(age).mul(-0.35), 0));
      const alive = step(0, age).mul(step(age, 3));
      material.scaleNode = alive.mul(hash(instanceIndex.add(44)).mul(0.04).add(0.012)).mul(float(1).sub(age.div(3)));
      material.colorNode = mix(vec3(1.8, 1.5, 1.2), vec3(1.6, 0.25, 0.1), min(age.mul(1.4), 1));
      material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length()).mul(max(fade.infra, 0.35)).mul(nearFade(0.8));
      const debris = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
      debris.count = DEBRIS;
      debris.frustumCulled = false;
      strata.infra.add(debris);
      pod.debris = age;
    }
    strata.infra.add(group);
    return pod;
  });
  const podById = Object.fromEntries(pods.map((p) => [p.spec.id, p]));

  /* ---------- the task queue: a tube with stripes that crawl as it drains, wide enough to fly through ---------- */
  const queueCurve = curveOf(QUEUE.points);
  const queueColor = uniform(new Color("#7dd3fc"));
  const queueFlow = uniform(0);
  const queueFill = uniform(0);
  {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const stripes = sin(uv().x.mul(160).sub(queueFlow)).mul(0.5).add(0.5).pow(6);
    const rings = sin(uv().y.mul(Math.PI * 2 * 6)).mul(0.5).add(0.5).pow(12);
    material.colorNode = queueColor.mul(float(0.6).add(stripes.mul(1.2)));
    material.opacityNode = float(0.05).add(stripes.mul(0.2)).add(rings.mul(0.04)).add(queueFill.mul(0.06)).mul(fade.infra).mul(nearFade(0.05));
    strata.infra.add(new Mesh(keep(new TubeGeometry(queueCurve, 240, QUEUE.radius, 24, false)), keep(material)));
  }

  /* ---------- paths: texture for the GPU, thin lines, and journey ribbons ---------- */
  const curves = [...PATHS.map((p) => curveOf(p.points)), queueCurve];
  const QUEUE_ROW = curves.length - 1;
  const rowOf = Object.fromEntries(PATHS.map((p, i) => [p.id, i]));
  const pathData = new Float32Array(SAMPLES * curves.length * 4);
  curves.forEach((curve, row) => {
    for (let i = 0; i < SAMPLES; i++) {
      const p = curve.getPointAt(i / (SAMPLES - 1));
      pathData.set([p.x, p.y, p.z, 1], (row * SAMPLES + i) * 4);
    }
  });
  const pathTexture = keep(new DataTexture(pathData, SAMPLES, curves.length, RGBAFormat, FloatType));
  pathTexture.minFilter = pathTexture.magFilter = NearestFilter;
  pathTexture.needsUpdate = true;
  const sample = (row, t) => {
    const fx2 = t.mul(SAMPLES - 1);
    const i0 = int(floor(fx2));
    const i1 = min(i0.add(1), int(SAMPLES - 1));
    return mix(textureLoad(pathTexture, ivec2(i0, row)).xyz, textureLoad(pathTexture, ivec2(i1, row)).xyz, fract(fx2));
  };
  const pathLines = PATHS.map((path, row) => {
    const line = lineGlow(0.14);
    line.color.value.set(path.color);
    strata.links.add(new Line(keep(new BufferGeometry().setFromPoints(curves[row].getSpacedPoints(300))), keep(line.material)));
    return line;
  });
  const ribbons = PATHS.filter((p) => p.journey).map((path) => {
    const curve = curves[rowOf[path.id]];
    const color = uniform(new Color(path.color));
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const dash = smoothstep(0.55, 1, sin(uv().x.mul(curve.getLength() * 2.2).sub(time.mul(6))).mul(0.5).add(0.5));
    material.colorNode = color.mul(float(0.5).add(dash));
    material.opacityNode = float(0.12).add(dash.mul(0.7)).mul(fade.ribbons).mul(nearFade(1.4));
    strata.links.add(new Mesh(keep(new TubeGeometry(curve, 600, 0.075, 8, false)), keep(material)));
    return { path, color };
  });

  /* Request particles: one instanced draw for every path, placed on the GPU from a hash and the path's offset. */
  const pathState = uniformArray(PATHS.map(() => new Vector3()), "vec3"); // offset, density, health
  const pathColor = uniformArray(PATHS.map((p) => new Color(p.color)), "color");
  {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const pid = instanceIndex.div(PER_PATH);
    const state = pathState.element(pid);
    const seed = hash(instanceIndex);
    const shown = step(hash(instanceIndex.add(101)), state.y);
    const t = fract(seed.add(state.x));
    const jitter = vec3(hash(instanceIndex.add(7)), hash(instanceIndex.add(13)), hash(instanceIndex.add(17))).sub(0.5).mul(0.2);
    material.positionNode = sample(int(pid), t).add(jitter);
    material.scaleNode = shown.mul(seed.mul(0.05).add(0.04));
    material.colorNode = mix(pathColor.element(pid), vec3(1, 0.25, 0.2), state.z.mul(0.85)).mul(1.1);
    material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length()).mul(fade.particles).mul(nearFade(0.5));
    const particles = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    particles.count = PER_PATH * PATHS.length;
    particles.frustumCulled = false;
    strata.links.add(particles);
  }
  /* Backlog: tasks waiting in the queue, crowding in as it fills. */
  {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const seed = hash(instanceIndex.add(5000));
    const shown = step(hash(instanceIndex.add(5100)), queueFill);
    const wobble = sin(time.mul(0.6).add(seed.mul(40))).mul(0.006);
    const t = fract(seed.add(queueFlow.mul(0.0008)).add(wobble)).mul(0.9).add(0.05);
    const spread = vec3(hash(instanceIndex.add(5200)), hash(instanceIndex.add(5300)), hash(instanceIndex.add(5400))).sub(0.5).mul(QUEUE.radius * 1.3);
    material.positionNode = sample(int(QUEUE_ROW), t).add(spread);
    material.scaleNode = shown.mul(seed.mul(0.025).add(0.02));
    material.colorNode = mix(vec3(0.5, 0.85, 1.0), vec3(1.0, 0.55, 0.15), queueFill).mul(0.9);
    material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length()).mul(fade.infra).mul(nearFade(0.05));
    const backlog = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    backlog.count = QUEUE_PARTICLES;
    backlog.frustumCulled = false;
    strata.infra.add(backlog);
  }

  /* The hero request the camera follows: a comet with a tail, sampled from the same path texture. */
  const comet = { u: uniform(0), row: uniform(0), on: uniform(0), color: uniform(new Color("#e9ffb0")) };
  {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const k = instanceIndex.toFloat();
    const t = max(comet.u.sub(k.mul(0.0016)), 0);
    material.positionNode = sample(int(comet.row), t);
    material.scaleNode = comet.on.mul(float(0.07).mul(exp(k.mul(-0.07))));
    material.colorNode = comet.color.mul(1.3);
    material.opacityNode = smoothstep(0.5, 0.0, uv().sub(0.5).length()).mul(exp(k.mul(-0.06))).mul(nearFade(0.4));
    const mesh = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    mesh.count = 40;
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  /* ---------- inside services: a membrane and a tunnel of stack-frame rings along the checkout path ---------- */
  const checkoutCurve = curves[rowOf.checkout];
  const frameAnchors = [];
  const membranes = [];
  const rings = [];
  NODES.filter((n) => n.frames).forEach((spec) => {
    const center = v3(spec.pos);
    const u0 = closestU(checkoutCurve, center);
    if (checkoutCurve.getPointAt(u0).distanceTo(center) > 0.3) return;
    const membrane = glow({ near: 0.08, side: DoubleSide });
    const cell = uv().mul(vec2(28, 14));
    const line = max(smoothstep(0.985, 1, abs(sin(cell.x.mul(PI)))), smoothstep(0.985, 1, abs(sin(cell.y.mul(PI)))));
    const rim = float(1).sub(abs(dot(normalView, positionViewDirection))).pow(3);
    membrane.material.opacityNode = line.mul(0.07).add(rim.mul(0.1)).add(0.012).mul(membrane.fade).mul(nearFade(0.08));
    const sphere = new Mesh(keep(new SphereGeometry(0.95, 48, 24)), keep(membrane.material));
    sphere.position.copy(center);
    strata.service.add(sphere);
    membranes.push({ spec, g: membrane, base: LAYER_COLOR[spec.layer] });
    const length = checkoutCurve.getLength();
    spec.frames.forEach((text, i) => {
      const u = Math.min(0.999, Math.max(0.001, u0 + ((i - (spec.frames.length - 1) / 2) * 0.55) / length));
      const pos = checkoutCurve.getPointAt(u);
      const ahead = checkoutCurve.getPointAt(Math.min(1, u + 0.002));
      const g = glow({ near: 0.12 });
      const ring = new Mesh(keep(new TorusGeometry(0.34, 0.01, 8, 64)), keep(g.material));
      ring.position.copy(pos);
      ring.lookAt(ahead);
      strata.service.add(ring);
      rings.push({ g, node: spec.id, phase: i });
      frameAnchors.push({ key: `frame:${spec.id}:${i}`, pos: pos.clone().add(new Vector3(0, 0.42, 0)), layer: "code", nearOnly: true, text });
    });
  });

  /* "runs on" threads from services to their pods. */
  const runsOn = RUNS_ON.map(([from, to]) => {
    const a = nodeById[from].mesh.position;
    const b = podById[to]?.center || nodeById[to].mesh.position;
    const line = lineGlow(0.22);
    strata.links.add(new Line(keep(new BufferGeometry().setFromPoints([a, b])), keep(line.material)));
    return { to, line };
  });

  /* Shockwaves rising from the infrastructure to each journey as it fails. */
  const shocks = JOURNEY_FAILS.map((fail) => {
    const g = glow({ opacity: 1 });
    const ring = new Mesh(keep(new TorusGeometry(0.6, 0.03, 8, 64)), keep(g.material));
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    return { ...fail, ring, g, top: v3(nodeById[fail.id].spec.pos) };
  });

  /* ---------- labels ---------- */
  const anchors = [
    ...NODES.map((n) => ({ key: n.id, pos: v3(n.pos), layer: n.layer, lift: n.kind === "journey" ? 1.0 : 0.62 })),
    ...DOMAINS.map((d) => ({ key: `domain:${d.id}`, pos: v3(d.center).add(new Vector3(0, d.r + 0.2, 0)), layer: "service", lift: 0 })),
    ...HOSTS.map((h) => ({ key: `host:${h.id}`, pos: v3(h.center).add(new Vector3(-h.size[0] / 2 + 0.6, h.size[1] / 2 + 0.25, h.size[2] / 2)), layer: "infra", lift: 0 })),
    ...PODS.map((p) => ({ key: `pod:${p.id}`, pos: podById[p.id].center, layer: "infra", lift: 0.6, pod: p.id })),
    { key: "queue", pos: queueCurve.getPointAt(0.45), layer: "infra", lift: 0.9 },
    ...frameAnchors.map((a) => ({ ...a, lift: 0 })),
  ];
  const tmp = new Vector3();
  const view = { w: 0, h: 0 };
  let labelsOn = 0;
  function placeLabels() {
    anchors.forEach((anchor) => {
      const el = labelRefs.current[anchor.key];
      if (!el) return;
      tmp.copy(anchor.pod ? podById[anchor.pod].group.position : anchor.pos);
      tmp.y += anchor.lift;
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const behind = tmp.z > 1;
      const near = Math.min(1, Math.max(0, (dist - 0.35) / 1.2));
      const far = anchor.nearOnly ? 1 - clamp01((dist - 3.5) / 2.5) : 1 - clamp01((dist - 18) / 22) * 0.6;
      const opacity = behind ? 0 : Math.max(0, fade[anchor.layer].value * near * far * labelsOn);
      el.style.opacity = opacity.toFixed(3);
      el.style.visibility = opacity < 0.02 ? "hidden" : "";
      el.style.transform = `translate3d(${(((tmp.x + 1) / 2) * view.w).toFixed(1)}px,${(((1 - tmp.y) / 2) * view.h).toFixed(1)}px,0) translate(-50%,-50%)`;
      el.style.zIndex = String(Math.round(1000 - dist * 10));
    });
  }

  /* ---------- the director ---------- */
  const worker2 = v3(podCenter("checkout-worker-2"));
  const nodeB = v3(HOSTS[1].center);
  const dwellStops = [...NODES.filter((n) => n.frames).map((n) => v3(n.pos)), worker2];
  const rideDwell = makeDwell(checkoutCurve, dwellStops, 3.2);
  const tunnelDwell = makeDwell(queueCurve, [], 0);
  const retryCurve = curves[rowOf.retry];
  const chapterEnd = (i) => CHAPTERS[i + 1]?.start ?? DURATION;
  const rideU = (t, i, lead = 0.8, tail = 0.6) => rideDwell((t - CHAPTERS[i].start - lead) / (chapterEnd(i) - CHAPTERS[i].start - lead - tail));
  const SHOTS = {
    assemble: (t) => {
      const k = smooth(t / 8);
      const a = 0.9 + t * 0.07;
      const r = 36 - k * 12;
      return [new Vector3(Math.sin(a) * r, 17 - k * 7, Math.cos(a) * r), new Vector3(0, 0.6, 0), 45];
    },
    ride: (t, i) => {
      const u = rideU(t, i);
      const pos = checkoutCurve.getPointAt(Math.max(0, u - 0.004)).add(new Vector3(0, 0.1, 0));
      return [pos, checkoutCurve.getPointAt(Math.min(1, u + 0.01)), 62];
    },
    "inside-pod": (t, i) => {
      const a = 0.4 + (t - CHAPTERS[i].start) * 0.16;
      return [worker2.clone().add(new Vector3(Math.cos(a) * 0.31, 0.29, Math.sin(a) * 0.31)), worker2.clone().add(new Vector3(0, -0.18, 0)), 78];
    },
    explode: (t, i) => {
      const k = smooth((t - CHAPTERS[i].start - 0.3) / 1.6);
      const inside = worker2.clone().add(new Vector3(0.18, 0.16, 0.16));
      const out = worker2.clone().add(new Vector3(3.2 + (t - CHAPTERS[i].start) * 0.15, 1.8, 4.6));
      return [inside.lerp(out, k), worker2.clone(), 74 - k * 26];
    },
    "ride-retry": (t, i) => {
      const u = clamp01((t - CHAPTERS[i].start - 0.8) / (chapterEnd(i) - CHAPTERS[i].start - 1.2));
      const pos = retryCurve.getPointAt(Math.max(0, u - 0.02)).add(new Vector3(0, 0.35, 0));
      return [pos, retryCurve.getPointAt(Math.min(1, u + 0.02)), 58];
    },
    tunnel: (t, i) => {
      const u = 0.04 + tunnelDwell(smooth((t - CHAPTERS[i].start) / (chapterEnd(i) - CHAPTERS[i].start))) * 0.86;
      return [queueCurve.getPointAt(u).add(new Vector3(0, 0.08, 0)), queueCurve.getPointAt(Math.min(1, u + 0.05)), 64];
    },
    cascade: (t, i) => {
      const a = 0.7 + (t - CHAPTERS[i].start) * 0.07;
      return [nodeB.clone().add(new Vector3(Math.sin(a) * 8, 3.4, Math.cos(a) * 8)), nodeB.clone().add(new Vector3(-2.2, 0.2, 0)), 46];
    },
    blast: (t, i) => {
      const k = smooth((t - CHAPTERS[i].start) / (chapterEnd(i) - CHAPTERS[i].start));
      return [new Vector3(-1 + k * 3, -9 + k * 9, 16 + k * 4), new Vector3(-1, 3.5 - k * 2, -1), 50];
    },
    outage: (t, i) => {
      const k = smooth((t - CHAPTERS[i].start) / 10);
      const a = 2.4 + (t - CHAPTERS[i].start) * 0.05;
      const r = 20 + k * 10;
      return [new Vector3(Math.sin(a) * r, 9 + k * 8, Math.cos(a) * r), new Vector3(0, 0.4, 0), 45];
    },
  };
  const shotAt = (i, t) => SHOTS[CHAPTERS[i].shot](t, i);

  const play = { t: 0, playing: false, speed: 1, director: true, lens: null };
  const offsets = PATHS.map(() => 0);
  let flow = 0;
  const camPos = new Vector3();
  const camLook = new Vector3();
  let camFov = 45;
  const scratch = new Color();
  let shake = 0;

  function direct(t, snap) {
    const index = CHAPTERS.reduce((found, chapter, i) => (t >= chapter.start ? i : found), 0);
    let [pos, look, fov] = shotAt(index, t);
    if (index > 0) {
      const k = smooth((t - CHAPTERS[index].start) / 2.2);
      if (k < 1) {
        const [prevPos, prevLook, prevFov] = shotAt(index - 1, t);
        pos = prevPos.lerp(pos, k);
        look = prevLook.lerp(look, k);
        fov = prevFov + (fov - prevFov) * k;
      }
    }
    const rate = snap ? 1 : 0.14;
    camPos.lerp(pos, rate);
    camLook.lerp(look, rate);
    camFov += (fov - camFov) * rate;
    camera.position.copy(camPos);
    if (shake > 0.001) camera.position.add(new Vector3(Math.sin(t * 91), Math.sin(t * 77 + 1), Math.sin(t * 83 + 2)).multiplyScalar(shake * 0.12));
    camera.lookAt(camLook);
    if (Math.abs(camera.fov - camFov) > 0.01) {
      camera.fov = camFov;
      camera.updateProjectionMatrix();
    }
  }

  /* ---------- lenses ---------- */
  let lensName = "all";
  let wipeStart = -1e9;
  let lastWall = performance.now();
  function setLensName(name) {
    if (name === lensName) return;
    lensName = name;
    wipeStart = performance.now();
    const accent = { all: "#a3e635", journey: "#f2f2ed", code: "#fde68a", infra: "#7dd3fc" }[name];
    fx.wipeColor.value.set(accent);
  }

  function apply(state, dt) {
    const { t, health, pods: podState, flow: pathFlow } = state;
    const chapter = CHAPTERS[state.chapter];
    setLensName(play.lens || chapter.lens);
    const lens = LENSES[lensName];
    // Lens fades and the wipe run on wall-clock time, so they stay crisp even when frames drop.
    const now = performance.now();
    const wall = Math.min(0.25, (now - lastWall) / 1000);
    lastWall = now;
    const ease = Math.min(1, wall * 4.5);

    // Prologue: infra rises, services bloom out, journeys descend, then the links light up.
    const aInfra = smooth((t - 0.3) / 4.5);
    const aService = smooth((t - 1.2) / 4.5);
    const aJourney = smooth((t - 2.2) / 4.5);
    const aLinks = smooth((t - 5) / 2.5);
    strata.infra.position.y = -9 * (1 - aInfra);
    strata.service.scale.setScalar(Math.max(0.001, aService));
    strata.journey.position.y = 9 * (1 - aJourney);
    labelsOn = smooth((t - 5.5) / 1.5);

    const assembly = { journey: aJourney, service: aService, infra: aInfra, code: aService, ribbons: aLinks, particles: aLinks, links: aLinks };
    Object.keys(fade).forEach((key) => {
      const target = (key === "links" ? Math.min(lens.service, lens.infra, 1) * 0.6 + 0.4 * lens.particles : lens[key]) * assembly[key];
      fade[key].value += (target - fade[key].value) * ease;
    });
    fx.tint.value.lerp(new Vector3(...lens.tint), ease);
    fx.sat.value += (lens.sat - fx.sat.value) * ease;
    const wipeT = (now - wipeStart) / 650;
    fx.wipe.value = wipeT < 1 ? 1 - wipeT : -1;

    nodes.forEach((node) => {
      const h = health[node.spec.id] ?? 0;
      node.parts.forEach((g) => {
        healthColor(node.base, h, g.color.value);
        g.alarm.value = h > 0.15 ? h : 0;
        g.fade.value = fade[node.spec.layer].value;
      });
      const emphasis = lensName === node.spec.layer ? 1.25 : 1;
      node.mesh.scale.setScalar(node.mesh.scale.x + (emphasis - node.mesh.scale.x) * ease);
      if (node.spec.kind === "journey") {
        node.mesh.rotation.x += dt * 0.6;
        node.mesh.rotation.y += dt * 0.9;
      } else if (node.spec.kind !== "db") {
        node.mesh.rotation.y += dt * (0.3 + h * 3);
      }
    });
    domains.forEach((domain) => {
      const members = NODES.filter((n) => n.domain === domain.spec.id);
      const h = Math.max(0, ...members.map((n) => health[n.id] ?? 0));
      domain.uniforms.forEach((u) => {
        healthColor(domain.base, h, u.color.value);
        u.alarm.value = h > 0.4 ? h * 0.5 : 0;
        u.fade.value = fade.service.value;
      });
      domain.lattice.rotation.y += dt * 0.05;
    });
    membranes.forEach(({ spec, g, base }) => {
      healthColor(base, health[spec.id] ?? 0, g.color.value);
      g.fade.value = Math.max(fade.code.value, fade[spec.layer].value * 0.4);
    });
    rings.forEach(({ g, node }) => {
      healthColor(CODE, health[node] ?? 0, g.color.value);
      g.fade.value = fade.code.value;
    });
    hosts.forEach((host) => {
      const h = health[host.spec.id] ?? 0;
      healthColor(LAYER_COLOR.infra, h, host.edges.color.value);
      host.fillGlow.color.value.copy(host.edges.color.value);
      host.fillGlow.alarm.value = h > 0.5 ? h : 0;
      host.edges.fade.value = host.fillGlow.fade.value = fade.infra.value;
    });

    // Pods: memory liquid, the receipt cache, OOM explosions and evictions.
    let impact = 0;
    pods.forEach((pod) => {
      const s = podState[pod.spec.id];
      const f = fade.infra.value;
      const memColor = healthColor(new Color("#4ade80"), clamp01((s.memory - 0.55) / 0.45));
      pod.group.position.copy(pod.center);
      pod.group.rotation.set(0, 0, 0);
      pod.group.visible = true;
      if (s.alive) {
        healthColor(LAYER_COLOR.infra, Math.max(0, s.memory - 0.5) * 2, pod.edges.color.value);
        pod.walls.color.value.copy(pod.edges.color.value);
        pod.gauge.color.value.copy(memColor);
        pod.gauge.alarm.value = s.memory > 0.85 ? 1 : 0;
        pod.fill.visible = true;
        pod.fill.scale.y = Math.max(0.02, s.memory) * 0.64;
        pod.fill.position.y = -0.32 + pod.fill.scale.y / 2;
        pod.edges.fade.value = pod.walls.fade.value = pod.gauge.fade.value = f;
        if (pod.cache) pod.cache.shown.value = Math.max(0, (s.memory - 0.35) / 0.65) * CACHE_SLOTS;
      } else {
        pod.fill.visible = false;
        if (pod.cache) pod.cache.shown.value = 0;
        const flash = Math.exp(-s.sinceKill * 2.5);
        pod.edges.color.value.copy(RED).multiplyScalar(0.6 + flash * 3);
        pod.walls.color.value.copy(RED);
        pod.edges.fade.value = f * (0.3 + flash * 0.7);
        pod.walls.fade.value = f * 0.25 * flash;
        if (pod.spec.fate === "evicted") {
          // Thrown out of its node, tumbling, then gone.
          const k = clamp01(s.sinceKill / 2.4);
          const out = Math.sign(pod.spec.offset[2]) || 1;
          pod.group.position.add(new Vector3(pod.spec.offset[0] * 0.6 * k, 3.2 * k - 1.6 * k * k, out * 4.5 * k));
          pod.group.rotation.set(k * 5, k * 3, k * 2);
          pod.edges.fade.value = f * (1 - smooth((k - 0.6) / 0.4));
          pod.edges.color.value.copy(AMBER).multiplyScalar(1.6);
          pod.group.visible = k < 1;
        }
      }
      const burst = s.sinceKill >= 0 && s.sinceKill < 1.4;
      pod.burst.visible = burst;
      if (burst) {
        pod.burst.scale.setScalar(1 + s.sinceKill * 6);
        pod.burstGlow.color.value.copy(pod.spec.fate === "evicted" ? AMBER : RED).multiplyScalar(2.2);
        pod.burstGlow.fade.value = (1 - s.sinceKill / 1.4) * f;
      }
      if (pod.debris) pod.debris.value = s.sinceKill;
    });
    KILLS.forEach((kill) => {
      const age = t - kill.t;
      if (age >= 0 && age < 2.5) impact = Math.max(impact, Math.exp(-age * 3) * (kill.fate === "oom" ? 1 : 0.45));
    });
    const latest = KILLS.filter((k) => t >= k.t).pop();
    if (latest) {
      const c = v3(podCenter(latest.id));
      shock.value.set(c.x, c.y, c.z, Math.exp(-(t - latest.t) * 2.5) * (t - latest.t < 3 ? 1 : 0));
    } else shock.value.w = 0;
    shake = impact;
    fx.chroma.value = impact * 1.1;
    fx.flash.value = impact * 0.12;

    runsOn.forEach(({ to, line }) => {
      const pod = podState[to];
      line.color.value.copy(pod && !pod.alive ? RED : LAYER_COLOR.journey);
      line.fade.value = Math.max(Math.min(fade.service.value, fade.infra.value), fade.links.value * 0.3);
    });
    PATHS.forEach((path, i) => {
      const f = pathFlow[path.id];
      offsets[i] += dt * f.speed * 0.06;
      const h = path.journey ? health[path.journey] : 0.3;
      pathState.array[i].set(offsets[i] % 1000, f.density * aLinks, h);
      healthColor(new Color(path.color), h, scratch);
      pathLines[i].color.value.copy(scratch);
      pathLines[i].fade.value = fade.links.value;
    });
    ribbons.forEach(({ path, color }) => healthColor(new Color(path.color), health[path.journey], color.value));
    shocks.forEach((s) => {
      const age = t - s.t;
      s.ring.visible = age >= 0 && age < 1.8;
      if (!s.ring.visible) return;
      const k = smooth(age / 1.4);
      s.ring.position.set(s.top.x, -4.5 + (s.top.y + 4.5) * k, s.top.z);
      s.ring.scale.setScalar(0.6 + k * 2.4);
      s.g.color.value.copy(RED).multiplyScalar(2);
      s.g.fade.value = (1 - smooth((age - 1.2) / 0.6)) * Math.max(fade.journey.value, 0.5);
    });

    // The hero comet: ahead of the camera on the ride, and on the retry loop.
    const ride = CHAPTERS.findIndex((c) => c.shot === "ride");
    const retry = CHAPTERS.findIndex((c) => c.shot === "ride-retry");
    if (state.chapter === ride) {
      comet.row.value = rowOf.checkout;
      comet.u.value = Math.min(1, rideU(t, ride) + 0.022);
      comet.color.value.set("#e9ffb0");
      comet.on.value = 1;
    } else if (state.chapter === retry) {
      comet.row.value = rowOf.retry;
      comet.u.value = clamp01((t - CHAPTERS[retry].start - 0.8) / (chapterEnd(retry) - CHAPTERS[retry].start - 1.2)) + 0.03;
      comet.color.value.set("#fdba74");
      comet.on.value = 1;
    } else comet.on.value = 0;

    flow += dt * (1 - state.queue * 0.85) * 4;
    queueFlow.value = flow;
    queueFill.value = state.queue;
    healthColor(LAYER_COLOR.infra, state.queue, queueColor.value);
    bloomPass.strength.value = 0.7 + Math.max(0, state.queue - 0.5) * 0.35 + impact * 0.8;
  }

  /* What the camera is inside right now, for the HUD. */
  function insideOf() {
    for (const pod of pods) {
      const p = camera.position.clone().sub(pod.group.position);
      if (pod.group.visible && Math.abs(p.x) < 0.36 && Math.abs(p.y) < 0.36 && Math.abs(p.z) < 0.36) return { kind: "pod", id: pod.spec.id };
    }
    for (const node of nodes) {
      if (node.spec.layer !== "journey" && camera.position.distanceTo(node.mesh.getWorldPosition(tmp)) < 0.95) return { kind: "node", id: node.spec.id };
    }
    const u = closestU(queueCurve, camera.position);
    if (queueCurve.getPointAt(u).distanceTo(camera.position) < QUEUE.radius) return { kind: "queue", id: QUEUE.id };
    return null;
  }

  /* ---------- loop ---------- */
  let last = 0;
  let lastTick = 0;
  let snapCamera = true;
  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === view.w && h === view.h) return;
    view.w = w;
    view.h = h;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  function frame(now) {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0);
    last = now;
    resize();
    if (play.playing) {
      play.t += dt * play.speed;
      if (play.t >= DURATION) {
        play.t = DURATION;
        play.playing = false;
      }
    }
    const state = stateAt(play.t);
    apply(state, dt);
    if (play.director) direct(play.t, snapCamera);
    else controls.update();
    snapCamera = false;
    if (motesUpdate) renderer.compute(motesUpdate);
    pipeline.render();
    placeLabels();
    if (now - lastTick > 120) {
      lastTick = now;
      onTick({ ...state, playing: play.playing, director: play.director, speed: play.speed, lens: lensName, lensLocked: Boolean(play.lens), inside: insideOf() });
    }
  }

  let running = false;
  const start = () => {
    if (running) return;
    running = true;
    last = 0;
    renderer.setAnimationLoop(frame);
  };
  const stop = () => {
    running = false;
    renderer.setAnimationLoop(null);
  };
  const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
  visibility.observe(stage);
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener("visibilitychange", onVisibility);
  // Grabbing the scene hands the camera to the viewer.
  const takeOver = () => {
    if (!play.director) return;
    play.director = false;
    controls.target.copy(camLook);
    controls.enabled = true;
  };
  canvas.addEventListener("pointerdown", takeOver);
  canvas.addEventListener("wheel", takeOver, { passive: true });

  start();

  return {
    backend,
    compute: Boolean(motesUpdate),
    play() {
      if (play.t >= DURATION) play.t = 0;
      play.playing = true;
    },
    pause() {
      play.playing = false;
    },
    seek(t) {
      play.t = Math.min(DURATION, Math.max(0, t));
      snapCamera = true;
    },
    setSpeed(speed) {
      play.speed = speed;
    },
    setDirector(on) {
      play.director = on;
      controls.enabled = !on;
      if (on) snapCamera = false;
      else controls.target.copy(camLook);
    },
    setLens(name) {
      play.lens = name;
    },
    dispose() {
      stop();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", takeOver);
      canvas.removeEventListener("wheel", takeOver);
      controls.dispose();
      disposables.forEach((item) => item.dispose?.());
      pipeline.dispose?.();
      renderer.dispose();
    },
  };
}
