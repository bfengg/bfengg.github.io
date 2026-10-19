import React, { useEffect, useRef, useState } from "react";
import { createEngine } from "../incident/engine";
import { DOMAINS, DURATION, FRAMES, HOSTS, NODES, PHASES, PODS, QUEUE } from "../incident/scenario";
import "../styles/IncidentReplay.css";

const LAYERS = [
  { id: "journey", label: "User journeys" },
  { id: "service", label: "Services & code" },
  { id: "infra", label: "Infrastructure" },
];
const JOURNEYS = NODES.filter((n) => n.kind === "journey");

const status = (h) => (h >= 0.75 ? "failing" : h >= 0.25 ? "degraded" : "ok");
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : Math.round(n).toString());
const seconds = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : s < 60 ? `${s.toFixed(0)} s` : `${(s / 60).toFixed(0)} min`);

/** A scripted fly-through of a cascading incident, from the pod that got OOMKilled up to the users who couldn't check out. */
function IncidentReplay() {
  const stage = useRef(null);
  const canvas = useRef(null);
  const labels = useRef({});
  const engine = useRef(null);
  const [backend, setBackend] = useState(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState(null);
  const [layers, setLayers] = useState({ journey: true, service: true, infra: true });
  const [codeOn, setCodeOn] = useState(true);

  useEffect(() => {
    let disposed = false;
    let instance = null;
    createEngine({ canvas: canvas.current, stage: stage.current, labelRefs: labels, onTick: setState }).then((created) => {
      if (disposed) {
        created?.dispose();
        return;
      }
      if (!created) {
        setFailed(true);
        return;
      }
      instance = created;
      engine.current = created;
      setBackend(created.backend);
      const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) created.play();
    });
    return () => {
      disposed = true;
      instance?.dispose();
      engine.current = null;
    };
  }, []);

  const toggleLayer = (id) => {
    const next = { ...layers, [id]: !layers[id] };
    setLayers(next);
    engine.current?.setLayer(id, next[id]);
  };

  if (failed) {
    return <div className="ir-panel ir-unsupported">This replay needs WebGPU or WebGL 2, and this browser has neither turned on.</div>;
  }

  const t = state?.t ?? 0;
  const phase = PHASES[state?.phase ?? 0];
  const label = (key, text, className) => (
    <span key={key} className={`ir-label ${className}`} ref={(el) => (labels.current[key] = el)}>
      {text}
    </span>
  );

  return (
    <div className="ir-panel">
      <div className="ir-stage" ref={stage}>
        <canvas ref={canvas} className="ir-canvas" aria-label="3D replay of a cascading incident" />
        <div className="ir-labels" data-code={codeOn || undefined} aria-hidden="true">
          {NODES.map((n) =>
            label(n.id, n.label, `ir-${n.layer}${state && (state.health[n.id] ?? 0) >= 0.75 ? " is-down" : ""}`)
          )}
          {DOMAINS.map((d) => label(`domain:${d.id}`, d.label, "ir-domain"))}
          {HOSTS.map((h) => label(`host:${h.id}`, h.label, "ir-host"))}
          {PODS.map((p) =>
            label(
              `pod:${p.id}`,
              <>
                {p.id}
                {state && !state.pods[p.id].alive && <em> OOMKilled</em>}
                {state && state.pods[p.id].alive && state.pods[p.id].memory > 0.8 && <em> {Math.round(state.pods[p.id].memory * 100)}% mem</em>}
              </>,
              "ir-pod"
            )
          )}
          {label("queue", <>{QUEUE.label}{state && <em> {compact(state.metrics.queueDepth)} waiting</em>}</>, "ir-queue")}
          {FRAMES.map((f, i) => label(`frame:${i}`, f.text, "ir-frame"))}
        </div>

        <div className="ir-hud ir-top">
          <div className="ir-phase">
            <span className="ir-step">
              {String((state?.phase ?? 0) + 1).padStart(2, "0")} / {String(PHASES.length).padStart(2, "0")}
            </span>
            <h3>{phase.title}</h3>
          </div>
          <div className="ir-journeys">
            {JOURNEYS.map((j) => {
              const s = status(state?.health[j.id] ?? 0);
              return (
                <span key={j.id} data-status={s}>
                  {j.label} <b>{s === "ok" ? "OK" : s}</b>
                </span>
              );
            })}
          </div>
        </div>

        <div className="ir-hud ir-story">
          <p>
            <span>Infra</span>
            {phase.infra}
          </p>
          <p>
            <span>Code</span>
            {phase.code}
          </p>
          <p>
            <span>Users</span>
            {phase.journey}
          </p>
          {state && (
            <dl>
              <div>
                <dt>Queue depth</dt>
                <dd>{compact(state.metrics.queueDepth)}</dd>
              </div>
              <div>
                <dt>Retries / s</dt>
                <dd>{compact(state.metrics.retries)}</dd>
              </div>
              <div>
                <dt>Schedule-to-start</dt>
                <dd>{seconds(state.metrics.scheduleToStart)}</dd>
              </div>
              <div>
                <dt>Error rate</dt>
                <dd>{Math.round(state.metrics.errorRate)}%</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="ir-hud ir-bottom">
          <button
            type="button"
            className="ir-play"
            aria-label={state?.playing ? "Pause" : "Play"}
            onClick={() => (state?.playing ? engine.current?.pause() : engine.current?.play())}
          >
            {state?.playing ? "❚❚" : "▶"}
          </button>
          <div className="ir-timeline">
            <input
              type="range"
              min={0}
              max={DURATION}
              step={0.05}
              value={t}
              aria-label="Incident timeline"
              onChange={(event) => engine.current?.seek(Number(event.target.value))}
            />
            <div className="ir-ticks">
              {PHASES.map((p, i) => (
                <button
                  key={p.title}
                  type="button"
                  style={{ left: `${(p.start / DURATION) * 100}%` }}
                  data-active={state?.phase === i || undefined}
                  onClick={() => engine.current?.seek(p.start + 0.01)}
                >
                  {p.title}
                </button>
              ))}
            </div>
          </div>
          <div className="ir-toggles">
            <button type="button" onClick={() => engine.current?.setSpeed(state?.speed === 2 ? 1 : 2)}>
              {state?.speed === 2 ? "2×" : "1×"}
            </button>
            <button type="button" aria-pressed={state?.director ?? true} onClick={() => engine.current?.setDirector(!(state?.director ?? true))}>
              {state?.director === false ? "Free camera" : "Director"}
            </button>
          </div>
        </div>

        <div className="ir-hud ir-layers">
          {LAYERS.map((l) => (
            <button key={l.id} type="button" aria-pressed={layers[l.id]} data-layer={l.id} onClick={() => toggleLayer(l.id)}>
              {l.label}
            </button>
          ))}
          <button type="button" aria-pressed={codeOn} data-layer="code" onClick={() => setCodeOn(!codeOn)}>
            Code frames
          </button>
          {backend && <span className="ir-backend">{backend}</span>}
        </div>
      </div>
    </div>
  );
}

export default IncidentReplay;
