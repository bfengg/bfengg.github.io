/* The incident in the replay is OpenAI's outage of December 11, 2024, as told in its public postmortem
   (https://status.openai.com/incidents/ctrsv3lwd797/write-up). A new telemetry service made every node in every
   cluster call the Kubernetes API, the API servers fell over, and once the nodes' DNS caches expired nothing could
   find anything: ChatGPT, the API and Sora went down for hours.

   The chain of events, the times and the fix come from the postmortem. The topology is a simplified sketch: one
   cluster stands in for the fleet, and the service names, stack frames and metric values are illustrative.

   The world is one volume with three strata that overlap in depth rather than sitting on flat planes:
   user journeys float on top, services sit inside their product domains in the middle, and the Kubernetes
   control plane, GPU nodes and DNS sit underneath. One request can be followed from what the user did, through
   the code it ran, to the pod it ran on. */

export const INCIDENT = {
  title: "OpenAI outage, December 11, 2024",
  source: "https://status.openai.com/incidents/ctrsv3lwd797/write-up",
};

export const DOMAINS = [
  { id: "chatgpt", label: "ChatGPT", center: [0.0, 1.4, 2.4], r: 1.6, color: "#a3e635" },
  { id: "inference", label: "Inference", center: [5.4, 1.4, 1.8], r: 2.3, color: "#fbbf24" },
  { id: "api", label: "API platform", center: [-1.8, 0.9, -4.6], r: 2.0, color: "#93c5fd" },
  { id: "sora", label: "Sora", center: [-6.2, 1.4, -0.6], r: 2.0, color: "#f0abfc" },
];

/* `layer`: journey, service or infra. `kind` picks the shape. `frames`: what a ChatGPT request runs inside this
   node, shown as rings the camera flies through. */
export const NODES = [
  { id: "journey-chat", layer: "journey", kind: "journey", label: "Chat in ChatGPT", pos: [1.8, 6.8, 2.4] },
  { id: "journey-api", layer: "journey", kind: "journey", label: "Call the API", pos: [-2.6, 6.0, -5.2] },
  { id: "journey-sora", layer: "journey", kind: "journey", label: "Make a Sora video", pos: [-6.4, 6.2, 0.8] },

  {
    id: "edge", layer: "service", kind: "service", label: "edge gateway", pos: [-2.4, 3.6, 3.6],
    frames: ["POST /backend-api/conversation", "auth.session(req)"],
  },
  {
    id: "conversation", layer: "service", kind: "service", label: "conversation-svc", pos: [0.0, 1.4, 2.4], domain: "chatgpt",
    frames: ["Conversation.append(message)", "moderation.check(message)"],
  },
  { id: "completions", layer: "service", kind: "service", label: "completions-api", pos: [-1.8, 0.9, -4.6], domain: "api" },
  { id: "sora-api", layer: "service", kind: "service", label: "sora-api", pos: [-6.2, 1.4, -0.6], domain: "sora" },
  {
    id: "router", layer: "service", kind: "workflow", label: "inference-router", pos: [4.2, 2.2, 1.0], domain: "inference",
    frames: ["router.pick(model)", "resolve('model-serving.svc')"],
  },
  {
    id: "model-serving", layer: "service", kind: "service", label: "model-serving", pos: [6.4, 1.0, 2.6], domain: "inference",
    frames: ["engine.generate(prompt)", "stream(tokens)"],
  },

  {
    id: "coredns", layer: "infra", kind: "temporal", label: "cluster DNS", pos: [3.6, -1.4, -1.6],
    frames: ["A? model-serving.svc", "answer from the API server's Endpoints"],
  },
  { id: "kube-apiserver", layer: "infra", kind: "temporal", label: "kube-apiserver", pos: [7.0, -1.6, -2.6] },
  { id: "etcd", layer: "infra", kind: "db", label: "etcd", pos: [5.6, -5.0, -5.6] },
];

/* Kubernetes nodes are glass boxes; pods are cubes inside them. `cache`: what the cubes inside a pod show.
   `fate`: oom (overwhelmed, explodes) or evicted (removed, thrown out). `down`: its label once gone. */
export const HOSTS = [
  { id: "control-plane", label: "control plane", center: [6.0, -4.6, -2.6], size: [4.6, 2.0, 2.4] },
  { id: "gpu-nodes", label: "GPU nodes", center: [-2.4, -4.4, 1.4], size: [7.2, 2.2, 3.6] },
];
export const PODS = [
  { id: "apiserver-1", host: "control-plane", offset: [-1.4, 0, 0], fate: "oom", down: "Overloaded", cache: "requests" },
  { id: "apiserver-2", host: "control-plane", offset: [0, 0, 0], fate: "oom", down: "Overloaded", cache: "requests" },
  { id: "apiserver-3", host: "control-plane", offset: [1.4, 0, 0], fate: "oom", down: "Overloaded", cache: "requests" },
  { id: "inference-1", host: "gpu-nodes", offset: [-2.6, 0, -0.9], cache: "dns" },
  { id: "telemetry-agent-1", host: "gpu-nodes", offset: [-1.3, 0, 0.9], fate: "evicted", down: "Removed" },
  { id: "inference-2", host: "gpu-nodes", offset: [0, 0, -0.9], cache: "dns" },
  { id: "telemetry-agent-2", host: "gpu-nodes", offset: [1.3, 0, 0.9], fate: "evicted", down: "Removed" },
  { id: "inference-3", host: "gpu-nodes", offset: [2.6, 0, -0.9], cache: "dns" },
];

export function podCenter(id) {
  const spec = PODS.find((p) => p.id === id);
  const host = HOSTS.find((h) => h.id === spec.host);
  return host.center.map((v, i) => v + spec.offset[i] + (i === 1 ? -0.2 : 0));
}
const at = (id) => NODES.find((n) => n.id === id).pos;

/* The flood of Kubernetes API calls from every node into the API server. It is wide enough to fly through. */
export const QUEUE = {
  id: "apiserver-flood",
  label: "calls to kube-apiserver",
  inside: "Kubernetes API calls from every node",
  points: [
    [0.4, -3.4, 2.2],
    [2.4, -2.0, 3.8],
    [4.8, -1.6, 2.6],
    [6.6, -1.0, -0.4],
    [7.0, -1.6, -2.6],
  ],
  radius: 0.55,
};

/* Request paths particles travel along. Each one threads the strata: journey → service → infra. */
export const PATHS = [
  {
    id: "chat",
    journey: "journey-chat",
    color: "#a3e635",
    points: [
      at("journey-chat"), at("edge"), at("conversation"), at("router"), at("coredns"), at("model-serving"),
      podCenter("inference-2"),
    ],
  },
  {
    id: "api",
    journey: "journey-api",
    color: "#93c5fd",
    points: [at("journey-api"), at("edge"), at("completions"), at("router"), at("model-serving"), podCenter("inference-3")],
  },
  {
    id: "sora",
    journey: "journey-sora",
    color: "#f0abfc",
    points: [at("journey-sora"), at("edge"), at("sora-api"), podCenter("inference-1")],
  },
  {
    // The new telemetry agent's API calls, from its node up into the API server.
    id: "telemetry",
    color: "#fb923c",
    points: [podCenter("telemetry-agent-2"), ...QUEUE.points],
  },
];

/* Which path the camera rides in "Follow one prompt", where it ends, and the pod it watches drown. */
export const RIDE = { path: "chat", pod: "inference-2" };
export const STORM_PATH = "telemetry";
export const FOCUS_POD = "apiserver-2";

/* "runs on" threads from a service down to what serves it. */
export const RUNS_ON = [
  ["model-serving", "inference-1"],
  ["model-serving", "inference-2"],
  ["model-serving", "inference-3"],
  ["kube-apiserver", "apiserver-1"],
  ["kube-apiserver", "apiserver-2"],
  ["kube-apiserver", "apiserver-3"],
  ["kube-apiserver", "etcd"],
  ["coredns", "kube-apiserver"],
  ["router", "coredns"],
];

/* Where each service runs, for the "inside" chip. */
export const RUNS_ON_LABEL = {
  edge: "in front of every product",
  conversation: "ChatGPT backend",
  completions: "API backend",
  "sora-api": "Sora backend",
  router: "finds model servers through cluster DNS",
  "model-serving": "inference-1/2/3 on the GPU nodes",
  coredns: "answers from the API server",
  "kube-apiserver": "apiserver-1/2/3",
};

/* The film, in seconds. Each chapter sets the camera shot and the lens (which stratum is in focus), and tells
   the story from three angles. A viewer can override the lens. */
export const DURATION = 96;
export const CHAPTERS = [
  {
    start: 0,
    title: "One fleet, three products",
    shot: "assemble",
    lens: "all",
    infra: "Kubernetes clusters: a control plane, GPU nodes, and DNS that service discovery depends on.",
    code: "Services find each other by name, and the cluster's DNS answers from the API server.",
    journey: "ChatGPT, the API and Sora all run on this fleet.",
  },
  {
    start: 8,
    title: "Follow one prompt",
    shot: "ride",
    lens: "code",
    infra: "The request lands on a GPU node. That node's DNS cache knows where everything is.",
    code: "Fly through each service and the frames it runs, down to the model server.",
    journey: "Someone sends a message in ChatGPT.",
  },
  {
    start: 28,
    title: "A new telemetry service",
    shot: "ride-retry",
    lens: "code",
    infra: "2:51 PM: a new agent rolls out to every node in every cluster. It passed in staging the day before.",
    code: "Each agent makes Kubernetes API calls whose cost grows with the size of the cluster.",
    journey: "Nothing visible yet.",
  },
  {
    start: 36,
    title: "Every node, all at once",
    shot: "tunnel",
    lens: "infra",
    infra: "Thousands of nodes run the same expensive calls together. In a small staging cluster this was cheap.",
    code: "The API servers' request queues climb from milliseconds to minutes.",
    journey: "Still nothing visible.",
  },
  {
    start: 44,
    title: "The API server drowns",
    shot: "inside-pod",
    lens: "infra",
    infra: "Inside apiserver-2: requests pile up faster than it can answer them.",
    code: "Deploys, scaling and rollbacks all go through this server.",
    journey: "Users are still fine. Every node is answering DNS from its cache.",
  },
  {
    start: 50,
    title: "Control plane down",
    shot: "explode",
    lens: "infra",
    infra: "3:12 PM: the API servers fall over in most large clusters.",
    code: "Nothing can change the cluster now, including removing the agent that broke it.",
    journey: "Alerts fire at 3:13 PM. Customers barely notice yet.",
  },
  {
    start: 58,
    title: "Living on cached DNS",
    shot: "cascade",
    lens: "infra",
    infra: "Each node's DNS cache keeps serving old answers for about 20 minutes, then they expire.",
    code: "The cache hid the failure, so the rollout kept going. Then lookups fail and services can't find each other.",
    journey: "3:16 PM: the first errors.",
  },
  {
    start: 70,
    title: "Every product down",
    shot: "blast",
    lens: "journey",
    infra: "The GPU nodes are healthy, but nothing can reach them.",
    code: "Inference ran without the control plane by design. Its DNS lookups still needed it.",
    journey: "3:40 PM, peak impact: ChatGPT, the API and Sora fail for most users.",
  },
  {
    start: 82,
    title: "Locked out of the fix",
    shot: "outage",
    lens: "all",
    infra: "Removing the agent needs the API server it broke. Teams shrink clusters, block admin API access and scale up the API servers.",
    code: "With access back, they delete the telemetry agent and move traffic to healthy clusters.",
    journey: "First cluster back at 4:36 PM; ChatGPT at 7:01 PM; the API at 7:38 PM.",
  },
];

/* Piecewise track with smoothstep easing: [[time, value], ...] in film seconds. */
function track(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        const k = (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * k * k * (3 - 2 * k);
      }
    }
    return keys[keys.length - 1][1];
  };
}
/* Same, but linear, for the clock. */
function linear(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1] = keys[i];
      if (t <= t1) {
        const [t0, v0] = keys[i - 1];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return keys[keys.length - 1][1];
  };
}

const TRACKS = {
  /* Pacific time, in minutes after noon, as the film plays. */
  clock: linear([[0, 140], [28, 171], [36, 177], [50, 192], [58, 196], [70, 220], [82, 225], [90, 276], [96, 458]]),
  memory: {
    "apiserver-1": track([[0, 0.34], [30, 0.36], [40, 0.6], [51, 0.98], [51.6, 0], [86, 0], [88, 0.4]]),
    "apiserver-2": track([[0, 0.36], [30, 0.38], [40, 0.66], [50.2, 0.99], [50.8, 0], [86, 0], [88, 0.42]]),
    "apiserver-3": track([[0, 0.32], [30, 0.34], [42, 0.58], [52, 0.97], [52.6, 0], [86, 0], [88, 0.38]]),
    "inference-1": track([[0, 0.6], [62, 0.6], [70, 0.3], [90, 0.3], [96, 0.55]]),
    "inference-2": track([[0, 0.64], [62, 0.64], [70, 0.3], [90, 0.3], [96, 0.6]]),
    "inference-3": track([[0, 0.58], [62, 0.58], [70, 0.28], [90, 0.28], [96, 0.55]]),
    "telemetry-agent-1": track([[0, 0.3]]),
    "telemetry-agent-2": track([[0, 0.3]]),
  },
  /* What the cubes inside a pod show: queued requests in an API server, or answers in a node's DNS cache. */
  cache: {
    "apiserver-1": track([[0, 0.04], [30, 0.04], [40, 0.4], [51, 1]]),
    "apiserver-2": track([[0, 0.05], [30, 0.05], [40, 0.45], [50.2, 1]]),
    "apiserver-3": track([[0, 0.03], [30, 0.03], [42, 0.4], [52, 1]]),
    "inference-1": track([[0, 1], [59, 1], [67, 0], [91, 0], [96, 1]]),
    "inference-2": track([[0, 1], [60, 1], [68, 0], [91, 0], [96, 1]]),
    "inference-3": track([[0, 1], [59.5, 1], [67.5, 0], [91, 0], [96, 1]]),
  },
  spawnAt: { "telemetry-agent-1": 30, "telemetry-agent-2": 31 },
  killedAt: {
    "apiserver-2": 50.6,
    "apiserver-1": 51.4,
    "apiserver-3": 52.4,
    "telemetry-agent-1": 88.4,
    "telemetry-agent-2": 88.8,
  },
  revivedAt: { "apiserver-1": 86.4, "apiserver-2": 86.8, "apiserver-3": 87.2 },
  health: {
    edge: track([[0, 0], [62, 0], [66, 0.4], [72, 0.85], [90, 0.85], [96, 0]]),
    conversation: track([[0, 0], [62, 0.1], [68, 0.8], [72, 1], [90, 1], [96, 0]]),
    completions: track([[0, 0], [62, 0.1], [68, 0.7], [73, 1], [90, 1], [96, 0]]),
    "sora-api": track([[0, 0], [63, 0.1], [69, 0.8], [74, 1], [90, 1], [96, 0]]),
    router: track([[0, 0], [60, 0.15], [66, 0.9], [70, 1], [90, 1], [96, 0]]),
    "model-serving": track([[0, 0], [62, 0.2], [68, 0.8], [72, 1], [90, 1], [96, 0]]),
    coredns: track([[0, 0], [50, 0.35], [56, 0.6], [62, 1], [88, 1], [92, 0.4], [96, 0]]),
    "kube-apiserver": track([[0, 0], [32, 0.1], [40, 0.45], [47, 0.8], [50.6, 1], [86, 1], [89, 0.35], [96, 0]]),
    etcd: track([[0, 0], [40, 0.15], [48, 0.5], [52, 0.6], [88, 0.4], [96, 0]]),
    "control-plane": track([[0, 0], [38, 0.3], [50, 1], [87, 1], [92, 0.2]]),
    "gpu-nodes": track([[0, 0], [62, 0.2], [70, 0.5], [92, 0.5], [96, 0]]),
    "journey-chat": track([[0, 0], [60, 0.05], [64, 0.3], [70, 0.9], [90, 0.9], [96, 0]]),
    "journey-api": track([[0, 0], [61, 0.05], [65, 0.3], [71, 0.95], [91, 0.95], [96, 0]]),
    "journey-sora": track([[0, 0], [61, 0.08], [66, 0.4], [72, 1], [90, 1], [96, 0]]),
  },
  /* Particle flow per path: density (share of particles shown) and speed. */
  density: {
    chat: track([[0, 0.6], [62, 0.55], [70, 0.06], [90, 0.06], [96, 0.6]]),
    api: track([[0, 0.5], [62, 0.45], [71, 0.05], [91, 0.05], [96, 0.5]]),
    sora: track([[0, 0.35], [62, 0.3], [72, 0.04], [90, 0.04], [96, 0.35]]),
    telemetry: track([[0, 0], [29, 0], [33, 0.5], [40, 1], [88, 1], [90, 0]]),
  },
  speed: {
    chat: track([[0, 1], [62, 0.9], [70, 0.15], [92, 0.15], [96, 0.8]]),
    api: track([[0, 1], [62, 0.9], [71, 0.15], [92, 0.15], [96, 0.8]]),
    sora: track([[0, 0.8], [62, 0.7], [72, 0.12], [92, 0.12], [96, 0.6]]),
    telemetry: track([[0, 1.4], [40, 1.8], [50, 0.5], [88, 0.4]]),
  },
  queue: track([[0, 0.04], [29, 0.04], [36, 0.35], [44, 0.75], [50, 1], [88, 1], [91, 0.05]]),
  metrics: {
    apiCalls: track([[0, 900], [29, 900], [36, 60000], [44, 410000], [50, 980000], [88, 980000], [91, 2000]]),
    apiLatency: track([[0, 0.03], [30, 0.03], [38, 0.8], [44, 9], [50, 60], [87, 60], [90, 0.4], [96, 0.05]]),
    dnsHit: track([[0, 99], [58, 99], [62, 70], [68, 3], [90, 3], [96, 99]]),
    errorRate: track([[0, 0.1], [58, 0.2], [62, 4], [66, 35], [70, 88], [90, 88], [96, 0.2]]),
  },
};

export const KILLS = Object.entries(TRACKS.killedAt).map(([id, t]) => ({ id, t, fate: PODS.find((p) => p.id === id).fate }));

/* The moment each journey tips into failing: a shockwave rises from the infra to it. */
export const JOURNEY_FAILS = NODES.filter((n) => n.kind === "journey").map((n) => {
  let t = 0;
  while (t < DURATION && TRACKS.health[n.id](t) < 0.75) t += 0.05;
  return { id: n.id, t };
});

export function chapterAt(t) {
  let index = 0;
  CHAPTERS.forEach((chapter, i) => {
    if (t >= chapter.start) index = i;
  });
  return index;
}

/* "3:12 PM" for the film's clock. */
export function clockAt(t) {
  const minutes = Math.floor(TRACKS.clock(t));
  const h = 12 + Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h > 12 ? h - 12 : h}:${String(m).padStart(2, "0")} PM`;
}

/** Everything the scene and HUD need at time `t`. */
export function stateAt(t) {
  const health = Object.fromEntries(Object.entries(TRACKS.health).map(([id, fn]) => [id, fn(t)]));
  const pods = Object.fromEntries(
    PODS.map(({ id }) => {
      const killedAt = TRACKS.killedAt[id];
      const revivedAt = TRACKS.revivedAt[id];
      const spawnAt = TRACKS.spawnAt[id] ?? -Infinity;
      const memory = TRACKS.memory[id]?.(t) ?? 0.3;
      const alive = killedAt === undefined || t < killedAt || (revivedAt !== undefined && t >= revivedAt);
      return [
        id,
        {
          memory,
          cache: TRACKS.cache[id]?.(t) ?? 0,
          present: t >= spawnAt,
          sinceSpawn: t - spawnAt,
          alive,
          sinceKill: killedAt === undefined ? -1 : t - killedAt,
        },
      ];
    })
  );
  const flow = Object.fromEntries(PATHS.map(({ id }) => [id, { density: TRACKS.density[id](t), speed: TRACKS.speed[id](t) }]));
  const metrics = Object.fromEntries(Object.entries(TRACKS.metrics).map(([id, fn]) => [id, fn(t)]));
  return { t, chapter: chapterAt(t), clock: clockAt(t), health, pods, flow, queue: TRACKS.queue(t), metrics };
}
