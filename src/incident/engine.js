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
  WebGPURenderer,
} from "three/webgpu";
import {
  abs,
  dot,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  int,
  ivec2,
  min,
  mix,
  normalView,
  pass,
  positionViewDirection,
  sin,
  smoothstep,
  step,
  textureLoad,
  time,
  uniform,
  uniformArray,
  uv,
  vec3,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DOMAINS, DURATION, FRAMES, HOSTS, NODES, PATHS, PHASES, PODS, QUEUE, RUNS_ON, stateAt } from "./scenario";

const SAMPLES = 256;
const PER_PATH = 700;
const QUEUE_PARTICLES = 1600;
const AMBER = new Color("#f59e0b");
const RED = new Color("#ef4444");
const LAYER_COLOR = { journey: new Color("#e9f5d0"), service: new Color("#a3e635"), infra: new Color("#7dd3fc") };

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

/* A flat glowing material: `alarm` (0..1) makes it throb faster and brighter, `fade` dims its layer. */
function glow({ opacity = 1, transparent = true, fresnel = false } = {}) {
  const color = uniform(new Color());
  const alarm = uniform(0);
  const fade = uniform(1);
  const material = new MeshBasicNodeMaterial({ transparent, depthWrite: !transparent });
  const pulse = sin(time.mul(alarm.mul(9).add(1.2))).mul(0.5).add(0.5);
  material.colorNode = color.mul(float(1).add(pulse.mul(alarm).mul(0.7)));
  const rim = fresnel ? float(1).sub(abs(dot(normalView, positionViewDirection))).pow(2.2).mul(0.4).add(0.015) : float(1);
  material.opacityNode = rim.mul(opacity).mul(fade);
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

/* Camera shots, by phase `shot`. Each returns [position, target] at time t. */
function makeShots(queueCurve) {
  const pos = new Vector3();
  const look = new Vector3();
  const orbit = (radius, height, speed, t, offset = 0) =>
    pos.set(Math.sin(t * speed + offset) * radius, height, Math.cos(t * speed + offset) * radius);
  return {
    wide: (t) => [orbit(21, 8, 0.05, t, 0.7).clone(), look.set(0, 0.6, 0).clone()],
    "node-b": (t) => [pos.set(5.4 - t * 0.04, -1.2, 9.2).clone(), look.set(1.6, -4.0, 1.6).clone()],
    pod: (t) => [pos.set(0.4 + Math.sin(t * 0.3) * 0.6, -3.0, 4.6).clone(), look.set(1.0, -4.5, 2.5).clone()],
    retry: (t) => [pos.set(13.5, 1.6 + Math.sin(t * 0.2), 7).clone(), look.set(5.5, -2.4, -1.2).clone()],
    tunnel: (t, start, end) => {
      const u = 0.04 + smooth((t - start) / (end - start)) * 0.86;
      return [queueCurve.getPointAt(u).add(new Vector3(0, 0.08, 0)), queueCurve.getPointAt(Math.min(1, u + 0.06))];
    },
    cascade: (t) => [pos.set(-3 + t * 0.05, 1.8, 13.5).clone(), look.set(-1.2, -3.2, 0.4).clone()],
    outage: (t) => [orbit(24, 15, 0.06, t, 2.2).clone(), look.set(0, -0.5, 0).clone()],
  };
}

export async function createEngine({ canvas, stage, labelRefs, onTick }) {
  const renderer = new WebGPURenderer({ canvas, antialias: true, alpha: false });
  try {
    await renderer.init();
  } catch (error) {
    return null;
  }
  const backend = renderer.backend?.isWebGPUBackend ? "WebGPU" : "WebGL 2";
  renderer.setClearColor("#07090a", 1);

  const scene = new Scene();
  scene.background = new Color("#07090a");
  scene.fog = new Fog("#07090a", 18, 46);
  const camera = new PerspectiveCamera(42, 1, 0.05, 200);
  camera.position.set(14, 9, 18);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enabled = false;
  controls.target.set(0, 0.5, 0);

  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  const bloomPass = bloom(sceneColor, 0.7, 0.45, 0.18);
  pipeline.outputNode = sceneColor.add(bloomPass);

  const world = new Group();
  scene.add(world);
  const layerFade = { journey: uniform(1), service: uniform(1), infra: uniform(1) };
  const layerTarget = { journey: 1, service: 1, infra: 1 };
  const disposables = [];
  const keep = (...items) => {
    disposables.push(...items);
    return items[0];
  };

  /* Dust for a sense of depth while flying. */
  {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const seed = hash(instanceIndex);
    material.positionNode = vec3(hash(instanceIndex.add(11)), hash(instanceIndex.add(23)), hash(instanceIndex.add(37)))
      .sub(0.5)
      .mul(vec3(46, 26, 40))
      .add(vec3(0, sin(time.mul(0.1).add(seed.mul(30))).mul(0.3), 0));
    material.scaleNode = seed.mul(0.05).add(0.015);
    material.colorNode = vec3(0.6, 0.75, 0.65);
    material.opacityNode = smoothstep(0.5, 0.0, uv().sub(0.5).length()).mul(0.35);
    const dust = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    dust.count = 900;
    dust.frustumCulled = false;
    world.add(dust);
  }

  /* Domains: fresnel bubbles with a slow wireframe shell. */
  const domains = DOMAINS.map((spec) => {
    const base = new Color(spec.color);
    const shell = glow({ fresnel: true });
    const bubble = new Mesh(keep(new SphereGeometry(spec.r, 48, 32)), keep(shell.material));
    bubble.position.set(...spec.center);
    const wire = glow({ opacity: 0.06 });
    wire.material.wireframe = true;
    const lattice = new Mesh(keep(new IcosahedronGeometry(spec.r * 1.02, 2)), keep(wire.material));
    bubble.add(lattice);
    world.add(bubble);
    return { spec, base, bubble, lattice, uniforms: [shell, wire] };
  });

  /* Journeys, services, Temporal and Postgres. */
  const nodes = NODES.map((spec) => {
    const g = glow({ transparent: true });
    let geometry;
    if (spec.kind === "journey") geometry = new TorusGeometry(0.62, 0.06, 12, 64);
    else if (spec.kind === "workflow") geometry = new OctahedronGeometry(0.42);
    else if (spec.kind === "temporal") geometry = new IcosahedronGeometry(0.42, 0);
    else if (spec.kind === "db") geometry = new CylinderGeometry(0.75, 0.75, 1.1, 32, 1, true);
    else geometry = new IcosahedronGeometry(0.3, 1);
    const mesh = new Mesh(keep(geometry), keep(g.material));
    mesh.position.set(...spec.pos);
    world.add(mesh);
    let core = null;
    if (spec.kind === "journey") {
      core = new Mesh(keep(new SphereGeometry(0.16, 16, 12)), g.material);
      core.position.copy(mesh.position);
      world.add(core);
    }
    if (spec.kind === "db") {
      const caps = glow({ opacity: 0.5 });
      caps.material.wireframe = true;
      const top = new Mesh(keep(new CylinderGeometry(0.75, 0.75, 1.1, 32, 3)), keep(caps.material));
      mesh.add(top);
      g.extra = caps;
    }
    return { spec, mesh, core, g, base: LAYER_COLOR[spec.layer] };
  });
  const nodeById = Object.fromEntries(nodes.map((n) => [n.spec.id, n]));

  /* Hosts (glass boxes) and pods (cubes with a memory gauge). */
  const hosts = HOSTS.map((spec) => {
    const box = new BoxGeometry(...spec.size);
    const edges = lineGlow(0.7);
    const outline = new LineSegments(keep(new EdgesGeometry(box)), keep(edges.material));
    const fillGlow = glow({ opacity: 0.035 });
    const fill = new Mesh(keep(box), keep(fillGlow.material));
    outline.position.set(...spec.center);
    fill.position.set(...spec.center);
    world.add(outline, fill);
    return { spec, edges, fillGlow };
  });
  const hostById = Object.fromEntries(hosts.map((h) => [h.spec.id, h]));
  const pods = PODS.map((spec) => {
    const host = hostById[spec.host].spec;
    const center = new Vector3(...host.center).add(new Vector3(...spec.offset)).add(new Vector3(0, -0.2, 0));
    const shellBox = new BoxGeometry(0.72, 0.72, 0.72);
    const edges = lineGlow(0.9);
    const outline = new LineSegments(keep(new EdgesGeometry(shellBox)), keep(edges.material));
    outline.position.copy(center);
    const gauge = glow({ opacity: 0.85 });
    const fill = new Mesh(keep(new BoxGeometry(0.56, 1, 0.56)), keep(gauge.material));
    fill.position.copy(center);
    const burstGlow = glow({ opacity: 1 });
    const burst = new Mesh(keep(new TorusGeometry(0.5, 0.025, 8, 48)), keep(burstGlow.material));
    burst.position.copy(center);
    burst.rotation.x = Math.PI / 2;
    world.add(outline, fill, burst);
    return { spec, center, edges, gauge, fill, burst, burstGlow };
  });
  const podById = Object.fromEntries(pods.map((p) => [p.spec.id, p]));

  /* The task queue: a tube with stripes that crawl as the queue drains, wide enough to fly through. */
  const queueCurve = curveOf(QUEUE.points);
  const queueColor = uniform(new Color("#7dd3fc"));
  const queueFlow = uniform(0);
  const queueFill = uniform(0);
  {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
    const stripes = sin(uv().x.mul(160).sub(queueFlow)).mul(0.5).add(0.5).pow(6);
    const rings = sin(uv().y.mul(Math.PI * 2 * 6)).mul(0.5).add(0.5).pow(12);
    material.colorNode = queueColor.mul(float(0.6).add(stripes.mul(1.4)));
    material.opacityNode = float(0.06).add(stripes.mul(0.22)).add(rings.mul(0.05)).add(queueFill.mul(0.08)).mul(layerFade.infra);
    const tube = new Mesh(keep(new TubeGeometry(queueCurve, 240, QUEUE.radius, 24, false)), keep(material));
    world.add(tube);
  }

  /* Paths as faint lines, plus the texture the particle shader samples them from. */
  const curves = [...PATHS.map((p) => curveOf(p.points)), queueCurve];
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
  const pathLines = PATHS.map((path, row) => {
    const line = lineGlow(0.16);
    line.color.value.set(path.color);
    const geometry = keep(new BufferGeometry().setFromPoints(curves[row].getSpacedPoints(200)));
    world.add(new Line(geometry, keep(line.material)));
    return line;
  });

  /* Request particles: one instanced draw for every path. Each particle's place on its path comes from the GPU
     (hash of its index + the path's running offset), so the CPU only moves four numbers per frame. */
  const pathState = uniformArray(PATHS.map(() => new Vector3()), "vec3"); // offset, density, health
  const pathColor = uniformArray(PATHS.map((p) => new Color(p.color)), "color");
  const sample = (row, t) => {
    const fx = t.mul(SAMPLES - 1);
    const i0 = int(floor(fx));
    const i1 = min(i0.add(1), int(SAMPLES - 1));
    const p0 = textureLoad(pathTexture, ivec2(i0, row)).xyz;
    const p1 = textureLoad(pathTexture, ivec2(i1, row)).xyz;
    return mix(p0, p1, fract(fx));
  };
  {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const pid = instanceIndex.div(PER_PATH);
    const state = pathState.element(pid);
    const seed = hash(instanceIndex);
    const shown = step(hash(instanceIndex.add(101)), state.y);
    const t = fract(seed.add(state.x));
    const jitter = vec3(hash(instanceIndex.add(7)), hash(instanceIndex.add(13)), hash(instanceIndex.add(17))).sub(0.5).mul(0.22);
    material.positionNode = sample(int(pid), t).add(jitter);
    material.scaleNode = shown.mul(seed.mul(0.06).add(0.05));
    material.colorNode = mix(pathColor.element(pid), vec3(1, 0.25, 0.2), state.z.mul(0.85)).mul(1.15);
    material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length());
    const particles = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    particles.count = PER_PATH * PATHS.length;
    particles.frustumCulled = false;
    world.add(particles);
  }
  /* Backlog: tasks waiting in the queue, crowding in as it fills. */
  {
    const material = new SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending });
    const seed = hash(instanceIndex.add(5000));
    const shown = step(hash(instanceIndex.add(5100)), queueFill);
    const wobble = sin(time.mul(0.6).add(seed.mul(40))).mul(0.006);
    const t = fract(seed.add(queueFlow.mul(0.0008)).add(wobble)).mul(0.9).add(0.05);
    const spread = vec3(hash(instanceIndex.add(5200)), hash(instanceIndex.add(5300)), hash(instanceIndex.add(5400))).sub(0.5).mul(QUEUE.radius * 1.3);
    material.positionNode = sample(int(curves.length - 1), t).add(spread);
    material.scaleNode = shown.mul(seed.mul(0.025).add(0.02));
    material.colorNode = mix(vec3(0.5, 0.85, 1.0), vec3(1.0, 0.55, 0.15), queueFill).mul(0.9);
    material.opacityNode = smoothstep(0.5, 0.05, uv().sub(0.5).length()).mul(layerFade.infra);
    const backlog = new Mesh(keep(new PlaneGeometry(1, 1)), keep(material));
    backlog.count = QUEUE_PARTICLES;
    backlog.frustumCulled = false;
    world.add(backlog);
  }

  /* "runs on" threads from services to their pods. */
  const runsOn = RUNS_ON.map(([from, to]) => {
    const a = nodeById[from].mesh.position;
    const b = podById[to]?.center || nodeById[to].mesh.position;
    const line = lineGlow(0.22);
    const geometry = keep(new BufferGeometry().setFromPoints([a, b]));
    world.add(new Line(geometry, keep(line.material)));
    return { from, to, line };
  });

  /* ---------- labels ---------- */
  const anchors = [
    ...NODES.map((n) => ({ key: n.id, pos: v3(n.pos), layer: n.layer, lift: n.kind === "journey" ? 0.95 : 0.6 })),
    ...DOMAINS.map((d) => ({ key: `domain:${d.id}`, pos: v3(d.center).add(new Vector3(0, d.r + 0.2, 0)), layer: "service", lift: 0 })),
    ...HOSTS.map((h) => ({ key: `host:${h.id}`, pos: v3(h.center).add(new Vector3(-h.size[0] / 2 + 0.6, h.size[1] / 2 + 0.25, h.size[2] / 2)), layer: "infra", lift: 0 })),
    ...PODS.map((p) => ({ key: `pod:${p.id}`, pos: podById[p.id].center.clone(), layer: "infra", lift: 0.6 })),
    { key: "queue", pos: queueCurve.getPointAt(0.45), layer: "infra", lift: 0.9 },
    ...FRAMES.map((f, i) => ({ key: `frame:${i}`, pos: v3(NODES.find((n) => n.id === f.at).pos), layer: "code", lift: -0.55 })),
  ];
  const tmp = new Vector3();
  const view = { w: 0, h: 0 };
  function placeLabels() {
    anchors.forEach((anchor) => {
      const el = labelRefs.current[anchor.key];
      if (!el) return;
      tmp.copy(anchor.pos);
      tmp.y += anchor.lift;
      const dist = tmp.distanceTo(camera.position);
      tmp.project(camera);
      const behind = tmp.z > 1;
      const layer = anchor.layer === "code" ? "service" : anchor.layer;
      const fade = layerFade[layer].value;
      const near = Math.min(1, Math.max(0, (dist - 0.6) / 1.4));
      const far = 1 - Math.min(1, Math.max(0, (dist - 16) / 22)) * 0.6;
      const opacity = behind ? 0 : Math.max(0, fade * near * far);
      el.style.opacity = opacity.toFixed(3);
      el.style.visibility = opacity < 0.02 ? "hidden" : "";
      el.style.transform = `translate3d(${(((tmp.x + 1) / 2) * view.w).toFixed(1)}px,${(((1 - tmp.y) / 2) * view.h).toFixed(1)}px,0) translate(-50%,-50%)`;
      el.style.zIndex = String(Math.round(1000 - dist * 10));
    });
  }

  /* ---------- timeline + director ---------- */
  const shots = makeShots(queueCurve);
  const play = { t: 0, playing: false, speed: 1, director: true };
  const offsets = PATHS.map(() => 0);
  let flow = 0;
  const camPos = new Vector3();
  const camLook = new Vector3();
  const scratch = new Color();

  function shotAt(index, t) {
    const phase = PHASES[index];
    const end = PHASES[index + 1]?.start ?? DURATION;
    return shots[phase.shot](t, phase.start, end);
  }
  function direct(t, snap) {
    const index = PHASES.reduce((found, phase, i) => (t >= phase.start ? i : found), 0);
    let [pos, look] = shotAt(index, t);
    if (index > 0) {
      const k = smooth((t - PHASES[index].start) / 2.4);
      if (k < 1) {
        const [prevPos, prevLook] = shotAt(index - 1, t);
        pos = prevPos.lerp(pos, k);
        look = prevLook.lerp(look, k);
      }
    }
    if (snap) {
      camPos.copy(pos);
      camLook.copy(look);
    } else {
      camPos.lerp(pos, 0.12);
      camLook.lerp(look, 0.12);
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  function apply(state, dt) {
    const { health, pods: podState, flow: pathFlow } = state;
    nodes.forEach((node) => {
      const h = health[node.spec.id] ?? 0;
      healthColor(node.base, h, node.g.color.value);
      node.g.alarm.value = h > 0.15 ? h : 0;
      node.g.fade.value = layerFade[node.spec.layer].value;
      if (node.g.extra) {
        node.g.extra.color.value.copy(node.g.color.value);
        node.g.extra.fade.value = node.g.fade.value;
      }
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
        u.fade.value = layerFade.service.value;
      });
      domain.lattice.rotation.y += dt * 0.05;
    });
    hosts.forEach((host) => {
      const h = health[host.spec.id] ?? 0;
      healthColor(LAYER_COLOR.infra, h, host.edges.color.value);
      host.fillGlow.color.value.copy(host.edges.color.value);
      host.fillGlow.alarm.value = h > 0.5 ? h : 0;
      host.edges.fade.value = host.fillGlow.fade.value = layerFade.infra.value;
    });
    pods.forEach((pod) => {
      const s = podState[pod.spec.id];
      const fade = layerFade.infra.value;
      if (s.alive) {
        healthColor(LAYER_COLOR.infra, Math.max(0, s.memory - 0.5) * 2, pod.edges.color.value);
        healthColor(new Color("#4ade80"), Math.max(0, (s.memory - 0.55) / 0.45), pod.gauge.color.value);
        pod.gauge.alarm.value = s.memory > 0.85 ? 1 : 0;
        pod.fill.visible = true;
        pod.fill.scale.y = Math.max(0.02, s.memory) * 0.56;
        pod.fill.position.y = pod.center.y - 0.28 + pod.fill.scale.y / 2;
        pod.edges.fade.value = fade;
      } else {
        pod.fill.visible = false;
        const flash = Math.exp(-s.sinceKill * 2.5);
        pod.edges.color.value.copy(RED).multiplyScalar(0.6 + flash * 3);
        pod.edges.fade.value = fade * (0.35 + flash * 0.65);
      }
      pod.gauge.fade.value = fade;
      const burst = s.sinceKill >= 0 && s.sinceKill < 1.4;
      pod.burst.visible = burst;
      if (burst) {
        pod.burst.scale.setScalar(1 + s.sinceKill * 5);
        pod.burstGlow.color.value.copy(RED).multiplyScalar(2.5);
        pod.burstGlow.fade.value = (1 - s.sinceKill / 1.4) * fade;
      }
    });
    runsOn.forEach(({ to, line }) => {
      const pod = podState[to];
      line.color.value.copy(pod && !pod.alive ? RED : LAYER_COLOR.journey);
      line.fade.value = Math.min(layerFade.service.value, layerFade.infra.value);
    });
    PATHS.forEach((path, i) => {
      const f = pathFlow[path.id];
      offsets[i] += dt * f.speed * 0.06;
      const h = path.journey ? health[path.journey] : 0.3;
      pathState.array[i].set(offsets[i] % 1000, f.density, h);
      healthColor(new Color(path.color), h, scratch);
      pathLines[i].color.value.copy(scratch);
    });
    flow += dt * (1 - state.queue * 0.85) * 4;
    queueFlow.value = flow;
    queueFill.value = state.queue;
    healthColor(LAYER_COLOR.infra, state.queue, queueColor.value);
    bloomPass.strength.value = 0.65 + Math.max(0, state.queue - 0.5) * 0.4;
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
    Object.keys(layerFade).forEach((key) => {
      const u = layerFade[key];
      u.value += (layerTarget[key] - u.value) * Math.min(1, dt * 6);
    });
    const state = stateAt(play.t);
    apply(state, dt);
    if (play.director) direct(play.t, snapCamera);
    else controls.update();
    snapCamera = false;
    pipeline.render();
    placeLabels();
    if (now - lastTick > 120) {
      lastTick = now;
      onTick({ ...state, playing: play.playing, director: play.director, speed: play.speed });
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
    play() {
      if (play.t >= DURATION) play.t = 0;
      play.playing = true;
    },
    pause() {
      play.playing = false;
    },
    seek(t) {
      play.t = Math.min(DURATION, Math.max(0, t));
    },
    setSpeed(speed) {
      play.speed = speed;
    },
    setDirector(on) {
      play.director = on;
      controls.enabled = !on;
      if (!on) controls.target.copy(camLook);
    },
    setLayer(layer, on) {
      layerTarget[layer] = on ? 1 : 0.08;
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
