import React from "react";
import dayjs from "dayjs";
import { coverageDescriptions } from "./data";
import { strokeColorScale } from "./colors";

export function SavingsPlanTooltip({
  activeKey,
  date,
  existing,
  current,
  projected,
}) {
  const rows = [
    { key: "existing", value: existing },
    { key: "current", value: current },
    { key: "projected", value: projected },
  ];
  const totalCoverage = existing + current + projected;

  return (
    <div className="flex gap-0 rounded-xl border border-gray-200 bg-white shadow-md overflow-hidden pointer-events-none">
      <div className="p-3 min-w-[200px]">
        <div className="text-sm font-bold mb-2">
          {dayjs(date).format("MMM YYYY")}
        </div>
        <div className="flex flex-col gap-1.5">
          {rows.map(
            ({ key, value }) =>
              value > 0 && (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-1 w-2.5 rounded-full"
                      style={{ background: strokeColorScale(key) }}
                    />
                    <div
                      className={`text-sm capitalize ${
                        key === activeKey ? "font-bold" : ""
                      }`}
                    >
                      {key}
                    </div>
                  </div>
                  <div className="text-sm tabular-nums">
                    {Math.round(value)}%
                  </div>
                </div>
              ),
          )}
          <div className="border-t border-gray-200 my-1" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="h-1 w-2.5 rounded-full bg-black" />
              <div className="text-sm">Total coverage</div>
            </div>
            <div className="text-sm tabular-nums">
              {Math.round(totalCoverage)}%
            </div>
          </div>
        </div>
      </div>
      {activeKey && (
        <div className="flex p-3 max-w-[200px] items-center justify-center border-l border-gray-200">
          <div className="text-xs text-gray-500">
            {coverageDescriptions[activeKey].description}
          </div>
        </div>
      )}
    </div>
  );
}
