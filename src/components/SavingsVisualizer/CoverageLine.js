import React from "react";
import { Text } from "@visx/text";
import { Line } from "@visx/shape";
import { COLOR_CONSTANTS } from "./colors";

function DragLabel({ x, y, displayText, position }) {
  const padding = { top: 8, left: 10, right: 10, bottom: 8 };
  const fontSize = 14;
  const textWidth = 28;
  const width = textWidth + padding.left + padding.right + 15;
  const height = fontSize + padding.top + padding.bottom;
  const yPos = position === "above" ? y - height : y;

  return (
    <g
      transform={`translate(${x - width / 2}, ${yPos})`}
      pointerEvents="visible"
      className="pointer-events-none"
    >
      {position === "above" ? (
        <g className="drop-shadow-[0_0_1.5px_rgba(0,0,0,0.2)]">
          <rect height={height} width={width} rx={height / 2} fill="white" />
          <rect height={height / 2} width={width} y={height / 2} fill="white" />
        </g>
      ) : (
        <g className="drop-shadow-[0_0_1.5px_rgba(0,0,0,0.2)]">
          <rect height={height / 2} width={width} fill="white" />
          <rect height={height} width={width} rx={height / 2} fill="white" />
        </g>
      )}
      <Text x={padding.left} y={20} textAnchor="start" fontSize={fontSize}>
        {displayText}
      </Text>
      <g transform={`translate(${width - 18}, 10)`}>
        <circle r="1.4" cx="0" cy="-3" fill="#888" />
        <circle r="1.4" cx="0" cy="3" fill="#888" />
        <circle r="1.4" cx="6" cy="-3" fill="#888" />
        <circle r="1.4" cx="6" cy="3" fill="#888" />
      </g>
    </g>
  );
}

export function CoverageLine({
  label,
  y,
  dy,
  xMax,
  isDragging,
  dragStart,
  dragEnd,
  dragMove,
}) {
  const handleWidth = 64;
  const handleHeight = 28;
  const handlePosition = label === "Goal" ? "above" : "below";

  return (
    <g
      pointerEvents="visible"
      onMouseDown={dragStart}
      onMouseUp={dragEnd}
      onMouseMove={isDragging ? dragMove : undefined}
      transform={`translate(0, ${y + dy})`}
    >
      <rect
        fill="transparent"
        className="cursor-ns-resize"
        height={handleHeight}
        y={handlePosition === "above" ? -handleHeight : 0}
        x={xMax - handleWidth / 2}
        width={handleWidth}
      />
      <DragLabel x={xMax} y={0} displayText={label} position={handlePosition} />
      <Line
        className="transition-opacity"
        style={{ opacity: isDragging ? 1 : 0.5 }}
        from={{ x: 0 }}
        to={{ x: xMax + handleWidth / 2 }}
        stroke={COLOR_CONSTANTS.lines}
        strokeWidth={2}
      />
    </g>
  );
}
