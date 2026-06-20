import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-4.6",
  compaction: {
    // Rendering produces long HTML; compact sooner so a multi-variation run stays coherent.
    thresholdPercent: 0.75,
  },
});
