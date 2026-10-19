/* Sample incident for the replay: a made-up storefront where a memory leak in the checkout workers turns into a
   Temporal retry storm that takes the whole cluster down. Every name here is invented.

   The world is one volume with three strata that overlap in depth rather than sitting on flat planes:
   user journeys float on top, services sit inside their business domains in the middle, and the
   Kubernetes nodes, pods, Temporal server and database sit underneath. Journeys reach all the way down,
   so one request can be followed from what the user did, through the code it ran, to the pod it ran on. */

export const DOMAINS = [
  { id: "catalog", label: "Catalog", center: [-6.2, 1.4, -0.6], r: 2.3, color: "#5eead4" },
  { id: "checkout", label: "Cart & Checkout", center: [1.2, 1.7, 1.2], r: 2.9, color: "#a3e635" },
  { id: "payments", label: "Payments", center: [6.6, 1.0, 2.6], r: 1.8, color: "#fbbf24" },
  { id: "orders", label: "Orders", center: [-1.8, 0.9, -4.6], r: 2.0, color: "#93c5fd" },
];

/* `layer`: journey, service or infra. `kind` picks the shape. `frames`: the stack frames a checkout request runs
   inside this node, shown as rings the camera flies through. */
export const NODES = [
  { id: "journey-browse", layer: "journey", kind: "journey", label: "Browse catalog", pos: [-6.4, 6.2, 0.8] },
  { id: "journey-checkout", layer: "journey", kind: "journey", label: "Check out", pos: [1.8, 6.8, 2.4] },
  { id: "journey-history", layer: "journey", kind: "journey", label: "Order history", pos: [-2.6, 6.0, -5.2] },

  {
    id: "storefront", layer: "service", kind: "service", label: "storefront-web", pos: [-2.4, 3.6, 3.6],
    frames: ["POST /api/checkout", "authMiddleware(req)", "CheckoutController.create()"],
  },
  { id: "catalog-api", layer: "service", kind: "service", label: "catalog-api", pos: [-6.2, 1.4, -0.6], domain: "catalog" },
  {
    id: "cart-svc", layer: "service", kind: "service", label: "cart-svc", pos: [-0.2, 1.1, 2.2], domain: "checkout",
    frames: ["CartService.submit(cartId)", "inventory.reserve(items)"],
  },
  {
    id: "checkout-wf", layer: "service", kind: "workflow", label: "CheckoutWorkflow", pos: [2.4, 2.5, 0.4], domain: "checkout",
    frames: ["client.start(CheckoutWorkflow)", "executeActivity(chargeCard, { retry })"],
  },
  {
    id: "payment-act", layer: "service", kind: "service", label: "ChargeCard activity", pos: [6.6, 1.0, 2.6], domain: "payments",
    frames: ["chargeCard(order)", "psp.capture(amount)", "receiptCache.set(id, pdf)  // never evicted"],
  },
  {
    id: "orders-api", layer: "service", kind: "service", label: "orders-api", pos: [-1.8, 0.9, -4.6], domain: "orders",
    frames: ["OrdersRepo.insert(order)"],
  },

  {
    id: "temporal-frontend", layer: "infra", kind: "temporal", label: "temporal frontend", pos: [8.4, -2.0, -2.2],
    frames: ["StartWorkflowExecution"],
  },
  { id: "temporal-history", layer: "infra", kind: "temporal", label: "temporal history", pos: [9.6, -3.4, -3.6], frames: ["ScheduleActivityTask"] },
  { id: "temporal-matching", layer: "infra", kind: "temporal", label: "temporal matching", pos: [7.4, -3.8, -4.4], frames: ["AddActivityTask → checkout-tq"] },
  { id: "postgres", layer: "infra", kind: "db", label: "postgres-primary", pos: [-3.0, -4.8, -6.4], frames: ["INSERT INTO orders …"] },
];

/* Kubernetes nodes are glass boxes; pods are cubes inside them. `service`: what the pod runs. */
export const HOSTS = [
  { id: "node-a", label: "k8s node-a", center: [-6.0, -4.4, 1.2], size: [5.6, 2.2, 3.6] },
  { id: "node-b", label: "k8s node-b", center: [1.6, -4.4, 1.6], size: [5.6, 2.2, 3.6] },
];
/* `fate`: oom (explodes) or evicted (thrown out of its node). */
export const PODS = [
  { id: "storefront-1", host: "node-a", service: "storefront", offset: [-1.9, 0, -0.9] },
  { id: "catalog-api-1", host: "node-a", service: "catalog-api", offset: [-0.6, 0, 0.9] },
  { id: "orders-api-1", host: "node-a", service: "orders-api", offset: [0.7, 0, -0.9] },
  { id: "checkout-worker-1", host: "node-a", service: "worker", offset: [1.9, 0, 0.9], fate: "oom" },
  { id: "cart-svc-1", host: "node-b", service: "cart-svc", offset: [-1.9, 0, -0.9], fate: "evicted" },
  { id: "checkout-worker-2", host: "node-b", service: "worker", offset: [-0.6, 0, 0.9], fate: "oom" },
  { id: "checkout-worker-3", host: "node-b", service: "worker", offset: [0.7, 0, -0.9], fate: "oom" },
  { id: "catalog-api-2", host: "node-b", service: "catalog-api", offset: [1.9, 0, 0.9], fate: "evicted" },
];

/* The Temporal task queue the checkout workers poll. It is wide enough to fly through. */
export const QUEUE = {
  id: "checkout-tq",
  label: "checkout-tq (task queue)",
  points: [
    [7.4, -3.8, -4.4],
    [6.4, -1.2, -2.0],
    [4.6, 0.6, 3.6],
    [2.6, -1.4, 5.4],
    [1.0, -3.6, 3.4],
  ],
  radius: 0.55,
};

export function podCenter(id) {
  const spec = PODS.find((p) => p.id === id);
  const host = HOSTS.find((h) => h.id === spec.host);
  return host.center.map((v, i) => v + spec.offset[i] + (i === 1 ? -0.2 : 0));
}
const at = (id) => NODES.find((n) => n.id === id).pos;

/* Request paths particles travel along. Each one threads the strata: journey → service → infra. */
export const PATHS = [
  {
    id: "browse",
    journey: "journey-browse",
    color: "#5eead4",
    points: [at("journey-browse"), at("storefront"), at("catalog-api"), podCenter("catalog-api-1"), at("postgres")],
  },
  {
    id: "checkout",
    journey: "journey-checkout",
    color: "#a3e635",
    points: [
      at("journey-checkout"), at("storefront"), at("cart-svc"), at("checkout-wf"), at("temporal-frontend"),
      at("temporal-history"), at("temporal-matching"), ...QUEUE.points.slice(1), podCenter("checkout-worker-2"),
      at("payment-act"), at("orders-api"), at("postgres"),
    ],
  },
  {
    id: "history",
    journey: "journey-history",
    color: "#93c5fd",
    points: [at("journey-history"), at("storefront"), at("orders-api"), podCenter("orders-api-1"), at("postgres")],
  },
  {
    // Temporal re-scheduling timed-out activities: back from the workers into history and the queue again.
    id: "retry",
    color: "#fb923c",
    points: [podCenter("checkout-worker-3"), [4.8, -1.6, 0.4], at("temporal-history"), at("temporal-matching"), ...QUEUE.points.slice(1)],
  },
];

/* "runs on" threads from a service down to the pods that serve it. */
export const RUNS_ON = [
  ["storefront", "storefront-1"],
  ["catalog-api", "catalog-api-1"],
  ["catalog-api", "catalog-api-2"],
  ["orders-api", "orders-api-1"],
  ["cart-svc", "cart-svc-1"],
  ["payment-act", "checkout-worker-1"],
  ["payment-act", "checkout-worker-2"],
  ["payment-act", "checkout-worker-3"],
  ["checkout-wf", "temporal-frontend"],
];

/* Where each service runs, for the "inside" chip. */
export const RUNS_ON_LABEL = {
  storefront: "storefront-1 on node-a",
  "catalog-api": "catalog-api-1 on node-a, catalog-api-2 on node-b",
  "cart-svc": "cart-svc-1 on node-b",
  "checkout-wf": "Temporal workflow",
  "payment-act": "checkout-worker-1/2/3",
  "orders-api": "orders-api-1 on node-a",
};

/* The film, in seconds. Each chapter sets the camera shot and the lens (which stratum is in focus), and tells
   the story from three angles. A viewer can override the lens. */
export const DURATION = 96;
export const CHAPTERS = [
  {
    start: 0,
    title: "One storefront, three ways to see it",
    shot: "assemble",
    lens: "all",
    infra: "Two nodes, eight pods, Temporal and Postgres.",
    code: "Six services; checkout runs as a Temporal workflow.",
    journey: "Three things users do: browse, check out, see orders.",
  },
  {
    start: 8,
    title: "Follow one checkout",
    shot: "ride",
    lens: "code",
    infra: "The request crosses two nodes and three Temporal services.",
    code: "Fly through each service and the stack frames it runs.",
    journey: "One click on Pay, about 40 ms when things are healthy.",
  },
  {
    start: 28,
    title: "A leak in the worker",
    shot: "inside-pod",
    lens: "infra",
    infra: "checkout-worker-2 climbs past 90% of its 512 Mi limit.",
    code: "chargeCard() caches every receipt PDF and never evicts one.",
    journey: "Nothing visible yet; p99 checkout latency drifts up.",
  },
  {
    start: 36,
    title: "OOMKilled",
    shot: "explode",
    lens: "infra",
    infra: "The kernel kills checkout-worker-2 (exit 137). Its in-flight activities vanish.",
    code: "Temporal sees heartbeat timeouts on every ChargeCard it held.",
    journey: "A slice of checkouts hang on the spinner.",
  },
  {
    start: 42,
    title: "Retry storm",
    shot: "ride-retry",
    lens: "code",
    infra: "History re-schedules each timed-out activity, immediately and without a cap.",
    code: "RetryPolicy { initialInterval: 1s, maximumAttempts: 0 } doubles the work in flight.",
    journey: "Users hit Pay again, which starts duplicate workflows on top.",
  },
  {
    start: 52,
    title: "Backlog in the queue",
    shot: "tunnel",
    lens: "infra",
    infra: "checkout-tq backs up; schedule-to-start goes from 40 ms to minutes.",
    code: "The two remaining workers each hold twice the activities, and twice the cache.",
    journey: "Checkout fails for most users. Browsing still works.",
  },
  {
    start: 62,
    title: "Cascade",
    shot: "cascade",
    lens: "infra",
    infra: "Workers 3 and 1 OOM in turn. node-b evicts catalog-api-2 and cart-svc-1.",
    code: "Temporal history shards fall behind; StartWorkflow calls time out.",
    journey: "Carts won't load. Browsing slows as catalog loses half its pods.",
  },
  {
    start: 72,
    title: "Blast radius",
    shot: "blast",
    lens: "journey",
    infra: "Every pod on node-b is gone; node-a is saturated.",
    code: "Every request path now waits on the same exhausted connection pool.",
    journey: "Checkout, then browsing, then order history go down.",
  },
  {
    start: 82,
    title: "Total outage",
    shot: "outage",
    lens: "all",
    infra: "Root cause: an unbounded cache, multiplied by unbounded retries.",
    code: "The fix: evict the cache, cap attempts, add backoff and a queue rate limit.",
    journey: "What users saw: everything, broken, for one bug in one activity.",
  },
];

/* Tracks were authored on a 48 s clock; this stretches them onto the film's chapters. */
const TIME_MAP = [
  [0, 0], [6, 28], [12, 36], [12.6, 36.6], [17, 42], [24, 52], [32, 62], [36.6, 68], [40, 74], [44, 82], [48, 96],
];
function remap(t) {
  for (let i = 1; i < TIME_MAP.length; i++) {
    const [a0, b0] = TIME_MAP[i - 1];
    const [a1, b1] = TIME_MAP[i];
    if (t <= a1) return b0 + ((t - a0) / (a1 - a0)) * (b1 - b0);
  }
  return DURATION;
}

/* Piecewise track with smoothstep easing: [[time, value], ...] on the 48 s clock. */
function track(rawKeys) {
  const keys = rawKeys.map(([t, v]) => [remap(t), v]);
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

const TRACKS = {
  memory: {
    "checkout-worker-2": track([[0, 0.42], [6, 0.48], [12, 0.97], [12.6, 0]]),
    "checkout-worker-3": track([[0, 0.38], [17, 0.45], [26, 0.82], [33, 0.99], [33.6, 0]]),
    "checkout-worker-1": track([[0, 0.36], [17, 0.42], [28, 0.8], [36, 0.99], [36.6, 0]]),
    "cart-svc-1": track([[0, 0.3], [32, 0.4], [35, 0.75], [36, 0]]),
    "catalog-api-2": track([[0, 0.34], [32, 0.4], [34.5, 0.7], [35, 0]]),
    "storefront-1": track([[0, 0.28], [36, 0.45], [44, 0.8]]),
    "catalog-api-1": track([[0, 0.32], [34, 0.55], [44, 0.86]]),
    "orders-api-1": track([[0, 0.3], [38, 0.5], [44, 0.82]]),
  },
  killedAt: {
    "checkout-worker-2": remap(12.4),
    "checkout-worker-3": remap(33.4),
    "checkout-worker-1": remap(36.4),
    "catalog-api-2": remap(34.8),
    "cart-svc-1": remap(35.8),
  },
  health: {
    storefront: track([[0, 0], [36, 0.1], [42, 0.85]]),
    "catalog-api": track([[0, 0], [33, 0], [36, 0.45], [42, 0.9]]),
    "cart-svc": track([[0, 0], [30, 0.2], [36, 1]]),
    "checkout-wf": track([[0, 0], [12, 0.1], [18, 0.5], [26, 0.85], [32, 1]]),
    "payment-act": track([[0, 0], [12, 0.35], [20, 0.7], [28, 1]]),
    "orders-api": track([[0, 0], [38, 0.2], [43, 0.9]]),
    "temporal-frontend": track([[0, 0], [24, 0.2], [34, 0.7], [41, 1]]),
    "temporal-history": track([[0, 0], [17, 0.3], [26, 0.6], [34, 0.9], [40, 1]]),
    "temporal-matching": track([[0, 0], [20, 0.3], [26, 0.75], [40, 1]]),
    postgres: track([[0, 0], [30, 0.1], [38, 0.6], [43, 1]]),
    "node-a": track([[0, 0], [38, 0.2], [44, 0.7]]),
    "node-b": track([[0, 0], [12, 0.2], [32, 0.6], [40, 1]]),
    "journey-browse": track([[0, 0], [34, 0.1], [38, 0.5], [41, 1]]),
    "journey-checkout": track([[0, 0], [8, 0.08], [13, 0.35], [20, 0.7], [26, 1]]),
    "journey-history": track([[0, 0], [38, 0.2], [42.5, 1]]),
  },
  /* Particle flow per path: density (share of particles shown) and speed. */
  density: {
    browse: track([[0, 0.55], [38, 0.5], [44, 0.08]]),
    checkout: track([[0, 0.6], [12, 0.5], [24, 0.25], [34, 0.06]]),
    history: track([[0, 0.4], [38, 0.35], [44, 0.05]]),
    retry: track([[0, 0], [14, 0], [18, 0.6], [24, 1], [36, 1], [44, 0.6]]),
  },
  speed: {
    browse: track([[0, 1], [36, 0.8], [44, 0.2]]),
    checkout: track([[0, 1], [12, 0.7], [24, 0.25], [32, 0.1]]),
    history: track([[0, 1], [38, 0.7], [44, 0.15]]),
    retry: track([[0, 1.4], [24, 1.1], [40, 0.4]]),
  },
  queue: track([[0, 0.05], [12, 0.1], [17, 0.35], [24, 0.7], [32, 0.95], [48, 1]]),
  metrics: {
    queueDepth: track([[0, 12], [12, 40], [17, 900], [24, 6400], [32, 21000], [40, 48000]]),
    retries: track([[0, 0], [12, 20], [17, 340], [24, 1800], [32, 4200], [40, 6100]]),
    errorRate: track([[0, 0.1], [12, 2], [17, 9], [24, 31], [32, 64], [40, 97]]),
    scheduleToStart: track([[0, 0.04], [12, 0.3], [17, 6], [24, 90], [32, 240], [40, 600]]),
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

/** Everything the scene and HUD need at time `t`. */
export function stateAt(t) {
  const health = Object.fromEntries(Object.entries(TRACKS.health).map(([id, fn]) => [id, fn(t)]));
  const pods = Object.fromEntries(
    PODS.map(({ id }) => {
      const killedAt = TRACKS.killedAt[id];
      const memory = TRACKS.memory[id]?.(t) ?? 0.3;
      return [id, { memory, alive: killedAt === undefined || t < killedAt, sinceKill: killedAt === undefined ? -1 : t - killedAt }];
    })
  );
  const flow = Object.fromEntries(PATHS.map(({ id }) => [id, { density: TRACKS.density[id](t), speed: TRACKS.speed[id](t) }]));
  const metrics = Object.fromEntries(Object.entries(TRACKS.metrics).map(([id, fn]) => [id, fn(t)]));
  return { t, chapter: chapterAt(t), health, pods, flow, queue: TRACKS.queue(t), metrics };
}
