import React, { useEffect, useRef, useState } from "react";
import { createEngine } from "../incident/engine";
import { CHAPTERS, DOMAINS, DURATION, HOSTS, NODES, PODS, QUEUE, RUNS_ON_LABEL } from "../incident/scenario";
import "../styles/IncidentReplay.css";

const LENSES = [
  { id: "all", label: "Everything" },
  { id: "journey", label: "Users" },
  { id: "code", label: "Code" },
  { id: "infra", label: "Infra" },
];
const LENS_STORY = { journey: "journey", code: "code", infra: "infra" };
const JOURNEYS = NODES.filter((n) => n.kind === "journey");
const FRAME_LABELS = NODES.filter((n) => n.frames).flatMap((n) => n.frames.map((text, i) => ({ key: `frame:${n.id}:${i}`, text })));

const status = (h) => (h >= 0.75 ? "failing" : h >= 0.25 ? "degraded" : "ok");
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : Math.round(n).toString());
const seconds = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : s < 60 ? `${s.toFixed(0)} s` : `${(s / 60).toFixed(0)} min`);

function insideText(inside, state) {
  if (!inside) return null;
  if (inside.kind === "pod") {
    const pod = PODS.find((p) => p.id === inside.id);
    const mem = state?.pods[inside.id];
    return { where: inside.id, detail: `pod on ${pod.host}${mem?.alive ? ` · ${Math.round(mem.memory * 512)} / 512 Mi` : ""}` };
  }
  if (inside.kind === "queue") return { where: QUEUE.id, detail: `Temporal task queue · ${compact(state?.metrics.queueDepth ?? 0)} tasks waiting` };
  const node = NODES.find((n) => n.id === inside.id);
  const domain = DOMAINS.find((d) => d.id === node.domain);
  const runs = RUNS_ON_LABEL[node.id];
  return { where: node.label, detail: [domain && `${domain.label} domain`, runs && `runs on ${runs}`, !domain && !runs && "infrastructure"].filter(Boolean).join(" · ") };
}

/** A directed fly-through of a cascading incident, from the pod that got OOMKilled up to the users who couldn't check out. */
function IncidentReplay() {
  const stage = useRef(null);
  const canvas = useRef(null);
  const labels = useRef({});
  const engine = useRef(null);
  const [backend, setBackend] = useState(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState(null);
  const [lens, setLens] = useState(null);

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
      setBackend(`${created.backend}${created.compute ? " · compute" : ""}`);
      const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) created.play();
    });
    return () => {
      disposed = true;
      instance?.dispose();
      engine.current = null;
    };
  }, []);

  const pickLens = (id) => {
    const next = lens === id ? null : id;
    setLens(next);
    engine.current?.setLens(next);
  };

  if (failed) {
    return <div className="ir-panel ir-unsupported">This replay needs WebGPU or WebGL 2, and this browser has neither turned on.</div>;
  }

  const t = state?.t ?? 0;
  const index = state?.chapter ?? 0;
  const chapter = CHAPTERS[index];
  const activeLens = state?.lens ?? "all";
  const inside = insideText(state?.inside, state);
  const director = state?.director ?? true;
  const label = (key, text, className) => (
    <span key={key} className={`ir-label ${className}`} ref={(el) => (labels.current[key] = el)}>
      {text}
    </span>
  );

  return (
    <div className="ir-panel" data-lens={activeLens} data-director={director || undefined}>
      <div className="ir-stage" ref={stage}>
        <canvas ref={canvas} className="ir-canvas" aria-label="3D replay of a cascading incident" />
        <div className="ir-labels" aria-hidden="true">
          {NODES.map((n) => label(n.id, n.label, `ir-${n.layer}${state && (state.health[n.id] ?? 0) >= 0.75 ? " is-down" : ""}`))}
          {DOMAINS.map((d) => label(`domain:${d.id}`, d.label, "ir-domain"))}
          {HOSTS.map((h) => label(`host:${h.id}`, h.label, "ir-host"))}
          {PODS.map((p) =>
            label(
              `pod:${p.id}`,
              <>
                {p.id}
                {state && !state.pods[p.id].alive && <em> {p.fate === "evicted" ? "Evicted" : "OOMKilled"}</em>}
                {state && state.pods[p.id].alive && state.pods[p.id].memory > 0.8 && <em> {Math.round(state.pods[p.id].memory * 100)}% mem</em>}
              </>,
              "ir-pod"
            )
          )}
          {label("queue", <>{QUEUE.label}{state && <em> {compact(state.metrics.queueDepth)} waiting</em>}</>, "ir-queue")}
          {FRAME_LABELS.map((f) => label(f.key, f.text, "ir-frame"))}
        </div>

        <div className="ir-letterbox" aria-hidden="true" />

        <div className="ir-hud ir-top">
          <div className="ir-lenses" role="group" aria-label="Lens">
            {LENSES.map((l) => (
              <button
                key={l.id}
                type="button"
                data-lens={l.id}
                aria-pressed={activeLens === l.id}
                data-locked={lens === l.id || undefined}
                onClick={() => pickLens(l.id)}
              >
                {l.label}
              </button>
            ))}
            <span className="ir-lens-mode">{lens ? "Your lens · click again to follow the story" : "Lens follows the story"}</span>
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

        <div className="ir-title" key={index}>
          <span className="ir-kicker">
            Chapter {index + 1} of {CHAPTERS.length}
          </span>
          <h3>{chapter.title}</h3>
          {inside && (
            <div className="ir-inside">
              <span>Inside</span> <b>{inside.where}</b> {inside.detail && <i>{inside.detail}</i>}
            </div>
          )}
        </div>

        <div className="ir-hud ir-story">
          {["journey", "code", "infra"].map((key) => (
            <p key={key} data-on={activeLens === "all" || LENS_STORY[activeLens] === key || undefined}>
              <span>{key === "journey" ? "Users" : key === "code" ? "Code" : "Infra"}</span>
              {chapter[key]}
            </p>
          ))}
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
                <dt>Sched-to-start</dt>
                <dd>{seconds(state.metrics.scheduleToStart)}</dd>
              </div>
              <div>
                <dt>Errors</dt>
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
              {CHAPTERS.map((c, i) => (
                <button
                  key={c.title}
                  type="button"
                  style={{ left: `${(c.start / DURATION) * 100}%` }}
                  data-active={index === i || undefined}
                  aria-label={c.title}
                  onClick={() => engine.current?.seek(c.start + 0.01)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          </div>
          <div className="ir-toggles">
            <button type="button" onClick={() => engine.current?.setSpeed(state?.speed === 2 ? 1 : 2)}>
              {state?.speed === 2 ? "2×" : "1×"}
            </button>
            <button type="button" aria-pressed={director} onClick={() => engine.current?.setDirector(!director)}>
              {director ? "Director" : "Free camera"}
            </button>
          </div>
          {backend && <span className="ir-backend">{backend}</span>}
        </div>
      </div>
    </div>
  );
}

export default IncidentReplay;
