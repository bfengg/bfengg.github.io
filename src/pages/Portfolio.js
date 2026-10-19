import React, { Suspense, lazy } from "react";
import "../styles/Portfolio.css";

// three.js is heavy, so the replay loads only when this page is opened.
const IncidentReplay = lazy(() => import("../components/IncidentReplay"));

const ENTRIES = [
  {
    id: "incident-replay",
    title: "Incident replay in 3D",
    year: "2026",
    stack: ["three.js WebGPU", "TSL shaders", "Compute shaders", "GPU-instanced particles", "Post-processing", "React"],
    summary:
      "A directed, 96-second film of one incident. A memory leak in a checkout worker gets it OOMKilled, Temporal retries the lost work without a cap, the task queue backs up, the rest of the cluster falls over, and every user journey goes dark. The camera rides a single request through each service and its stack frames, dives into the leaking pod, and tunnels through the backed-up queue. Lenses switch the same scene between what users saw, what the code did, and what the infrastructure did.",
    hint: "It plays on its own. Pick a lens to hold one view, drag to take the camera, or jump between chapters on the timeline. All names and numbers are sample data.",
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
