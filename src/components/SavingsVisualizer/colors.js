import { scaleOrdinal } from "@visx/scale";

export const COLOR_CONSTANTS = {
  lines: "#D5D5D5",
  axisLabel: "#73757A",
  existing: "#BCBBB6",
  current: "#55B5A6",
  future: "#845EEE",
};

export const keys = ["current", "existing", "projected"];

export const fillColorScale = scaleOrdinal({
  range: [
    "url(#current-gradient)",
    "url(#existing-gradient)",
    "url(#projected-gradient)",
  ],
  domain: keys,
});

export const strokeColorScale = scaleOrdinal({
  range: [
    COLOR_CONSTANTS.current,
    COLOR_CONSTANTS.existing,
    COLOR_CONSTANTS.future,
  ],
  domain: keys,
});
