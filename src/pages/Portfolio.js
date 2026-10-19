import React, { Suspense, lazy } from "react";
import "../styles/Portfolio.css";

// three.js is heavy, so the replay loads only when this page is opened.
const IncidentReplay = lazy(() => import("../components/IncidentReplay"));

const ENTRIES = [
  {
    id: "incident-replay",
    title: "Incident replay in 3D",
    year: "2026",
    stack: ["three.js WebGPU", "TSL shaders", "GPU-instanced particles", "Bloom", "React"],
    summary:
      "One OOMKilled pod turns into a Temporal retry storm and takes a whole cluster down. The replay flies through it with user journeys on top, services inside their business domains in the middle and the Kubernetes nodes, task queue and database underneath, so the same failure reads as a pod, a code path and a broken checkout at once.",
    hint: "Drag to take the camera, scrub the timeline or jump to a phase, and switch layers on and off. The camera tunnels through the task queue as it backs up. All names and numbers are sample data.",
    Demo: IncidentReplay,
  },
];

function Portfolio() {
  return (
    <div className="portfolio">
      <header className="portfolio-head">
        <h2>Portfolio</h2>
        <p>Things I've built, mostly about making systems legible.</p>
      </header>
      {ENTRIES.map(({ id, title, year, stack, summary, hint, Demo }) => (
        <section className="portfolio-entry" key={id} id={id}>
          <div className="portfolio-meta">
            <h3>{title}</h3>
            <span>{year}</span>
          </div>
          <p className="portfolio-summary">{summary}</p>
          <ul className="portfolio-stack">
            {stack.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Suspense fallback={<div className="portfolio-loading">Loading the 3D scene…</div>}>
            <Demo />
          </Suspense>
          <p className="portfolio-hint">{hint}</p>
        </section>
      ))}
    </div>
  );
}

export default Portfolio;
