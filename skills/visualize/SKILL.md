---
name: visualize
description: Serve the live KHB bundle graph. Use when the user wants to see the bundle map or after bundles/refs change.
---

# Visualize KHB

1. Run `khb visualize` (aliases: `vis`, `viz`) from anywhere inside the hub — it walks up
   to `khb.json` to find the root, serves the graph from a local server, prints the URL and
   opens it in the default browser (`--no-open` to skip that). It binds a random free port
   unless `--port N` pins one (falling back to a random port if that one's taken).
2. Two zoom levels: top level shows bundles as nodes (sized by concept count) with directed
   `refs.md` edges — that view is the cross-bundle map. Click a bundle to drill into its
   concepts; the `← all bundles` button or Escape comes back out. Clicking empty space does
   nothing — it will not throw you out of the bundle.
3. Inside a bundle the concepts are grouped into labelled regions, one per top-level
   subdirectory (`tables/`, `notes/`, …), rather than floating freely — so the shape you
   see is how the bundle is actually organised. Deeper subdirectories fold into their
   top-level folder.
4. The canvas pans and zooms: wheel to zoom at the cursor, drag the background to pan,
   `fit` in the top bar or the `F` key to reframe everything. The opening view is already
   settled and framed, zoomed in far enough to read.
5. Node labels are the concept `title`, clipped, and any label that would collide with
   another is left out — so text stays sparse and readable. Zoom in to reveal more of
   them. The `type` is the node's colour; it is named in words in the hover strip at the
   bottom and in the panel, so there is no legend to consult.
6. Click a concept to open a side panel with its untruncated title, full path, type, and
   body, fetched on demand from the server. The theme toggle (dark/light) in the top bar
   is remembered between runs.
7. A refresh button rescans the hub live and refetches the graph — useful mid-catalog, when
   the graph is still changing.
8. The server exits on its own once you close the browser tab (no need to hunt down a
   background process); Ctrl+C also works.
