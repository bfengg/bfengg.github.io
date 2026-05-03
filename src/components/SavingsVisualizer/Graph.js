/* eslint-disable react/no-children-prop */
import React, { useCallback, useMemo, useState } from "react";
import dayjs from "dayjs";
import { scaleLinear, scaleTime } from "@visx/scale";
import { AreaStack, Bar, Line } from "@visx/shape";
import { LinearGradient } from "@visx/gradient";
import { curveStepAfter } from "@visx/curve";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { Group } from "@visx/group";
import {
  useTooltip,
  useTooltipInPortal,
  TooltipWithBounds,
  defaultStyles,
} from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { bisector } from "@visx/vendor/d3-array";
import { Drag } from "@visx/drag";
import { motion } from "framer-motion";
import { CoverageLine } from "./CoverageLine";
import { SavingsPlanTooltip } from "./Tooltip";
import { calculateDateRange } from "./data";
import {
  COLOR_CONSTANTS,
  fillColorScale,
  keys,
  strokeColorScale,
} from "./colors";

const margins = { top: 40, right: 40, bottom: 50, left: 40 };

export function Graph({
  data,
  height,
  width,
  onCoverageChange,
  maximumCoverage,
  minimumCoverage,
}) {
  const [activeStack, setActiveStack] = useState(null);
  const {
    tooltipData,
    tooltipLeft,
    tooltipTop,
    tooltipOpen,
    showTooltip,
    hideTooltip,
  } = useTooltip();
  const { containerRef } = useTooltipInPortal({
    detectBounds: true,
    scroll: true,
  });

  const { minDate, maxDate, numMonths } = calculateDateRange(data);
  const parsedData = useMemo(() => data, [data]);
  const currentMonth = dayjs().startOf("month");

  const xMax = width - margins.left - margins.right;
  const yMax = height - margins.top - margins.bottom;

  const xScale = scaleTime({ range: [0, xMax], domain: [minDate, maxDate] });
  const yScale = scaleLinear({ range: [yMax, 0], domain: [0, 100] });

  const handleTooltip = useCallback(
    (event) => {
      const { x, y } = localPoint(event) || { x: 0, y: 0 };
      const x0 = xScale.invert(x - margins.left - xMax / numMonths / 2);
      const index = bisector((d) => d.date.toDate()).center(parsedData, x0, 1);
      const d0 = parsedData[index - 1];
      const d1 = parsedData[index];
      let d = d0;
      if (d1)
        d =
          x0.valueOf() - dayjs(d0.date).valueOf() >
          dayjs(d1.date).valueOf() - x0.valueOf()
            ? d1
            : d0;
      showTooltip({
        tooltipData: { activeKey: activeStack, ...d },
        tooltipLeft: xScale(d.date),
        tooltipTop: y + margins.top,
      });
    },
    [xScale, parsedData, showTooltip, activeStack, xMax, numMonths],
  );

  return (
    <div className="select-none">
      <svg width={width} height={height} ref={containerRef} className="relative">
        <LinearGradient
          id="existing-gradient"
          from={COLOR_CONSTANTS.existing}
          to={COLOR_CONSTANTS.existing}
          fromOpacity={0.5}
          toOpacity={0.1}
        />
        <LinearGradient
          id="current-gradient"
          from={COLOR_CONSTANTS.current}
          to={COLOR_CONSTANTS.current}
          fromOpacity={0.5}
          toOpacity={0.1}
        />
        <LinearGradient
          id="projected-gradient"
          from={COLOR_CONSTANTS.future}
          to={COLOR_CONSTANTS.future}
          fromOpacity={0.5}
          toOpacity={0.1}
        />
        <Group top={margins.top} left={margins.left}>
          {tooltipData && (
            <rect
              x={tooltipLeft}
              y={0}
              height={height - margins.bottom - margins.top}
              width={xMax / numMonths}
              fill={COLOR_CONSTANTS.axisLabel}
              opacity={0.05}
              className="pointer-events-none"
            />
          )}

          <Bar
            y={-margins.top}
            width={Math.max(xMax - xMax / numMonths, 0)}
            height={Math.max(height - margins.bottom, 0)}
            fill="transparent"
            onTouchStart={handleTooltip}
            onTouchMove={handleTooltip}
            onMouseMove={handleTooltip}
            onMouseLeave={() => hideTooltip()}
          />

          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ delay: 0.2 }}
          >
            <AreaStack
              keys={keys}
              top={margins.top}
              left={margins.left}
              data={parsedData}
              x={(d) => xScale(d.data.date) ?? 0}
              y0={(d) => yScale(d[0])}
              y1={(d) => yScale(d[1])}
              curve={curveStepAfter}
            >
              {({ stacks, path }) =>
                stacks.reverse().map((stack, index) => (
                  <motion.path
                    key={`stack-${stack.key}`}
                    initial={false}
                    animate={{
                      d: path(stack) || "",
                      fillOpacity: activeStack
                        ? stack.key === activeStack
                          ? 1
                          : 0.2
                        : 0.7,
                      strokeOpacity: activeStack ? 0.5 : 1,
                    }}
                    fill={fillColorScale(keys[keys.length - 1 - index])}
                    transition={{ type: "spring", damping: 20, stiffness: 200 }}
                    stroke={strokeColorScale(keys[keys.length - 1 - index])}
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                    onTouchStart={(e) => {
                      handleTooltip(e);
                      setActiveStack(stack.key);
                    }}
                    onTouchMove={(e) => {
                      handleTooltip(e);
                      setActiveStack(stack.key);
                    }}
                    onMouseEnter={(e) => {
                      handleTooltip(e);
                      setActiveStack(stack.key);
                    }}
                    onMouseMove={handleTooltip}
                    onMouseLeave={() => {
                      hideTooltip();
                      setActiveStack(null);
                    }}
                  />
                ))
              }
            </AreaStack>
          </motion.g>

          <Line
            x1={xScale(currentMonth)}
            x2={xScale(currentMonth)}
            y1={yMax}
            y2={0}
            stroke={COLOR_CONSTANTS.lines}
            strokeDasharray="3 3"
            strokeWidth={1.5}
            strokeOpacity={0.5}
          />
          <Line
            x1={xScale(currentMonth.add(1, "year"))}
            x2={xScale(currentMonth.add(1, "year"))}
            y1={yMax}
            y2={0}
            stroke={COLOR_CONSTANTS.lines}
            strokeDasharray="3 3"
            strokeWidth={1.5}
            strokeOpacity={0.5}
          />

          <AxisLeft
            scale={yScale}
            tickFormat={(d) => `${d}%`}
            hideTicks
            stroke={COLOR_CONSTANTS.lines}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            tickLabelProps={{ fill: COLOR_CONSTANTS.axisLabel, fontSize: 12 }}
          />
          <AxisBottom
            top={yMax}
            scale={xScale}
            numTicks={
              width < 800
                ? Math.min(6, numMonths / 2)
                : Math.min(12, numMonths)
            }
            tickFormat={(d) => {
              const date = dayjs(Number(d));
              return date.month() === 0 ? date.format("YYYY") : date.format("MMM");
            }}
            stroke={COLOR_CONSTANTS.lines}
            hideTicks
            strokeWidth={1.5}
            tickLabelProps={{ fill: COLOR_CONSTANTS.axisLabel, fontSize: 12 }}
          />

          <Drag
            height={height}
            width={width + margins.right}
            resetOnStart
            snapToPointer={false}
            restrict={{ yMin: yScale(maximumCoverage), yMax }}
            y={yScale(minimumCoverage)}
            onDragEnd={({ y = 0, dy }) => {
              let v = Math.round(yScale.invert(y + dy));
              v = Math.ceil(v / 5) * 5;
              onCoverageChange("min", v);
            }}
            children={({
              y: minY = 0,
              dy: minDY,
              isDragging,
              dragStart,
              dragEnd,
              dragMove,
            }) => (
              <CoverageLine
                label="Min"
                y={minY}
                dy={minDY}
                xMax={xMax}
                isDragging={isDragging}
                dragStart={dragStart}
                dragEnd={dragEnd}
                dragMove={dragMove}
              />
            )}
          />

          <Drag
            height={height}
            width={width + margins.right}
            resetOnStart
            snapToPointer={false}
            restrict={{ yMin: 0, yMax: yScale(minimumCoverage) }}
            y={yScale(maximumCoverage)}
            onDragEnd={({ y = 0, dy }) => {
              let v = Math.round(yScale.invert(y + dy));
              v = Math.ceil(v / 5) * 5;
              onCoverageChange("max", v);
            }}
            children={({
              y: maxY = 0,
              dy: maxDY,
              isDragging,
              dragStart,
              dragEnd,
              dragMove,
            }) => (
              <CoverageLine
                label="Goal"
                y={maxY}
                dy={maxDY}
                xMax={xMax}
                isDragging={isDragging}
                dragStart={dragStart}
                dragEnd={dragEnd}
                dragMove={dragMove}
              />
            )}
          />
        </Group>
      </svg>
      {tooltipOpen && tooltipData && (
        <TooltipWithBounds
          key={Math.random()}
          top={tooltipTop}
          left={(tooltipLeft ?? 0) + 64 + xMax / numMonths}
          style={{
            ...defaultStyles,
            boxShadow: "none",
            padding: 0,
            margin: 0,
            borderRadius: 12,
            background: "transparent",
          }}
        >
          <SavingsPlanTooltip {...tooltipData} />
        </TooltipWithBounds>
      )}
    </div>
  );
}
