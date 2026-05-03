import React, { useMemo, useState } from "react";
import ParentSize from "@visx/responsive/lib/components/ParentSize";
import { Graph } from "./Graph";
import { buildGraphData, DEMO_COMMITMENTS, coverageDescriptions } from "./data";
import { strokeColorScale } from "./colors";

export function SavingsVisualizer() {
  const [minCoverage, setMinCoverage] = useState(40);
  const [maxCoverage, setMaxCoverage] = useState(80);

  const data = useMemo(
    () => buildGraphData(DEMO_COMMITMENTS, minCoverage, maxCoverage),
    [minCoverage, maxCoverage],
  );

  const handleCoverageChange = (type, value) => {
    if (type === "min") setMinCoverage(Math.min(value, maxCoverage));
    else setMaxCoverage(Math.max(value, minCoverage));
  };

  const snapshot = data[24] ?? data[data.length - 1];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h1 className="font-bold text-base">Savings Plans Scheduler</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Drag the <strong>Min</strong> and <strong>Goal</strong> handles on
          the graph (or use the sliders) to see recommendations adjust. Numbers
          are static demo data.
        </p>
      </div>
      <div className="grid lg:grid-cols-3 gap-0">
        <div className="lg:col-span-2 p-6 border-b lg:border-b-0 border-gray-200">
          <div className="h-[500px]">
            <ParentSize>
              {({ width, height }) => (
                <Graph
                  data={data}
                  width={width}
                  height={height}
                  minimumCoverage={minCoverage}
                  maximumCoverage={maxCoverage}
                  onCoverageChange={handleCoverageChange}
                />
              )}
            </ParentSize>
          </div>
          <div className="flex flex-wrap justify-center gap-6 pt-4">
            {Object.keys(coverageDescriptions).map((key) => (
              <div
                key={key}
                className="flex items-center gap-2"
                title={coverageDescriptions[key].description}
              >
                <div
                  className="h-1 w-3 rounded-full"
                  style={{ background: strokeColorScale(key) }}
                />
                <div className="text-sm text-gray-700">
                  {coverageDescriptions[key].label}
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="lg:border-l border-gray-200 p-6">
          <h2 className="font-bold mb-1">Coverage Goals</h2>
          <p className="text-sm text-gray-500 mb-4">
            Adjust the coverage corridor.
          </p>
          <div className="space-y-5">
            <SliderRow
              label="Coverage Goal"
              hint="Stop recommending once we hit this."
              value={maxCoverage}
              min={minCoverage}
              max={100}
              onChange={setMaxCoverage}
            />
            <SliderRow
              label="Minimum Coverage"
              hint="Always keep at least this much covered."
              value={minCoverage}
              min={0}
              max={maxCoverage}
              onChange={setMinCoverage}
            />
          </div>
          <hr className="my-6 border-gray-200" />
          <h2 className="font-bold mb-3">12 months from now</h2>
          <div className="space-y-2 text-sm">
            <SnapshotRow
              color={strokeColorScale("existing")}
              label="Existing"
              value={snapshot.existing}
            />
            <SnapshotRow
              color={strokeColorScale("current")}
              label="Add now"
              value={snapshot.current}
            />
            <SnapshotRow
              color={strokeColorScale("projected")}
              label="Add later"
              value={snapshot.projected}
            />
            <div className="flex justify-between font-bold border-t border-gray-200 pt-2 mt-2">
              <span>Total target</span>
              <span className="tabular-nums">
                {Math.round(
                  snapshot.existing + snapshot.current + snapshot.projected,
                )}
                %
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SliderRow({ label, hint, value, min, max, onChange }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-sm font-medium">{label}</label>
        <span className="font-mono text-sm tabular-nums">{value}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
      <div className="text-xs text-gray-500 mt-1">{hint}</div>
    </div>
  );
}

function SnapshotRow({ color, label, value }) {
  return (
    <div className="flex justify-between items-center">
      <div className="flex items-center gap-2">
        <div
          className="h-1 w-3 rounded-full"
          style={{ background: color }}
        />
        <span>{label}</span>
      </div>
      <span className="tabular-nums">{Math.round(value)}%</span>
    </div>
  );
}
