# Geometry Strategy

The editor renders chip layouts that come from Qiskit Metal's `QGeometry`
tables via the bridge. We use SVG transport as the MVP format.

## Active — SVG strings from the bridge

The bridge serializes component previews and full-design renders to an SVG
fragment (inner markup without an `<svg>` wrapper) plus a `viewBox` and unit
string. The frontend embeds the fragment inside its canvas SVG and applies
pan/zoom via a CSS transform on the parent group.

**Why SVG:**
- Zero geometry math in the frontend — Qiskit Metal is the single source of
  truth for shapes.
- Embed in React with `<g dangerouslySetInnerHTML={{ __html: svg }} />`.
- Scales losslessly; supports printing.
- Diffable per route — `POST /design/render` returns per-connection route SVGs
  so the editor can swap one route without re-rendering the whole design.

**Endpoints used:**
- `GET /components/{id}/preview` → component shape on canvas and thumbnail in
  the library.
- `POST /design/render` → full chip layout with `layers[]` and `routes[]`.

**Unit handling:**
- Bridge returns geometry in micrometers (`units: "um"`).
- Frontend scales with `zoom × MM_TO_PX × UM_TO_MM` (= `zoom × 80 × 0.001`),
  so 1 µm maps to 0.08 screen pixels at zoom 1.
- Y-axis is flipped (`scaleY(-1)`) because SVG Y-down conflicts with the
  canvas Y-up world space.

## Future — QGeometry → JSON

When designs grow past the SVG performance envelope the bridge will be
extended with `POST /design/render?format=qgeometry`, returning Qiskit Metal's
`QGeometry` tables as JSON (per-layer polygons, paths, junctions):

```json
{
  "layers": [
    { "name": "metal", "polygons": [ { "points": [[x,y], ...], "holes": [] } ], "paths": [] }
  ],
  "units": "um"
}
```

The frontend will then render via Canvas2D or WebGL for large designs where
SVG DOM node count becomes the bottleneck (roughly >5 000 polygons).

**When to switch:** render times for `POST /design/render` exceed ~150 ms for
a typical design, or DOM node count for a single layout crosses ~5 000.
