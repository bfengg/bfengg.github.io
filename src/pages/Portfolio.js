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
      "A directed, 96-second film of OpenAI's outage on December 11, 2024. A new telemetry service made every node in every cluster call the Kubernetes API at once, the API servers fell over, and about 20 minutes later, when the nodes' DNS caches expired, services could no longer find each other. ChatGPT, the API and Sora went down for over four hours, and the fix was slow because removing the agent needed the API server it had broken. The camera rides one ChatGPT request through each service, follows a telemetry agent's call into the API server, flies down the flood of calls, and sits inside an API server as it drowns. Lenses switch the same scene between what users saw, what the code did, and what the infrastructure did.",
    hint: "It plays on its own. Pick a lens to hold one view, drag to take the camera, or jump between chapters on the timeline. The events and times come from OpenAI's public postmortem; the topology is simplified, and the service names, stack frames and metric values are illustrative.",
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
