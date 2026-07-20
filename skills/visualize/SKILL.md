---
name: visualize
description: Regenerate the BKR bundle graph (visualizer/graph.html). Use when the user wants to see the bundle map or after bundles/refs change.
---

# Visualize BKR

1. Run `bkr visualize` from the hub root.
2. Output is `visualizer/graph.html` — self-contained; open in any browser. Nodes are
   bundles (sized by concept count), directed edges are `refs.md` relationships.
