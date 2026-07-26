---
name: visualize
description: Regenerate the KHB bundle graph (visualizer/graph.html). Use when the user wants to see the bundle map or after bundles/refs change.
---

# Visualize KHB

1. Run `khb visualize` from anywhere inside the hub — it walks up to `khb.json` to find the
   root, and writes to the hub root regardless of where you ran it.
2. Output is `visualizer/graph.html` — self-contained; open in any browser. Nodes are
   bundles (sized by concept count), directed edges are `refs.md` relationships.
