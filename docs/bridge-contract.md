# Silicofeller ↔ Qiskit Metal Bridge Contract

This document is the authoritative contract between the React frontend and the
FastAPI Python bridge. The bridge implementation lives in `backend/`.

> Configuration: the frontend reads the bridge base URL from
> `import.meta.env.VITE_BRIDGE_URL`. When unset, the UI shows a
> "Development preview" banner and uses mock fixtures. When set, every UI
> element — component list, parameters, pin positions, SVG shapes, generated
> code — comes exclusively from the live Qiskit Metal installation.

## Architecture invariants

1. Qiskit Metal is the **single source of truth** for components, parameters,
   pins, geometry, connectivity, and generated Python code.
2. The frontend stores only: what was placed, where, with what parameters,
   and how it is connected.
3. The frontend never instantiates `QComponent`, never calls `design.rebuild()`,
   never computes geometry.
4. Every design must be exportable as a self-contained Qiskit Metal Python
   script via `POST /design/generate-code`. `pip install qiskit-metal &&
   python design.py` must work.

## Caching requirement (bridge side)

The bridge SHOULD memoize the results of `GET /components`,
`GET /components/{id}/metadata`, and `GET /components/{id}/pins` for the
lifetime of the Python process. Cold requests must not rescan Qiskit Metal.
The frontend additionally caches all GETs in TanStack Query for 24 h
(invalidatable from the Bridge Status panel).

---

## Endpoints

### `GET /components`

List every `QComponent` subclass registered in the running Qiskit Metal
process.

```json
[
  { "id": "TransmonPocket", "name": "Transmon Pocket", "module": "qiskit_metal.qlibrary.qubits.transmon_pocket", "category": "qubits" },
  { "id": "RouteMeander",   "name": "Route Meander",   "module": "qiskit_metal.qlibrary.tlines.meandered",        "category": "routes" }
]
```

### `GET /components/{id}`

Single component summary. Same shape as a list element, plus an optional
`description: string`.

### `GET /components/{id}/metadata`

Parameter schema derived from `default_options` + class docstrings.

```json
{
  "id": "TransmonPocket",
  "parameters": [
    { "name": "pad_width",  "type": "length", "unit": "um", "default": "455", "description": "Width of qubit pads" },
    { "name": "pad_height", "type": "length", "unit": "um", "default": "90",  "description": "Height of qubit pads" },
    { "name": "pos_x",      "type": "length", "unit": "mm", "default": "0",   "description": "X position" }
  ],
  "supportedRouteComponents": ["RouteMeander", "RouteStraight"]
}
```

`type` is one of `length | string | number | bool | enum`. Enum entries
include an `options: string[]` field. `supportedRouteComponents` is required
only for components that originate connections (qubits, couplers); for route
components themselves it is omitted.

### `GET /components/{id}/pins`

Pin list extracted from `QComponent` pin metadata.

```json
{
  "id": "TransmonPocket",
  "pins": [
    { "name": "readout", "direction": "out", "hint": { "x": 0,    "y":  120, "angle":  90 } },
    { "name": "bus_01",  "direction": "io",  "hint": { "x": -160, "y":  0,   "angle": 180 } }
  ]
}
```

`hint` coordinates are in **millimetres** relative to the component's origin
at its default parameter values, used by the editor to position pin handles
before the bridge has rendered the design.

### `GET /components/{id}/preview?params=<urlencoded-json>`

Render a single component at the supplied (or default) parameters and return
an SVG string.

```json
{
  "id": "TransmonPocket",
  "svg": "<g>...</g>",
  "viewBox": { "x": -240, "y": -160, "w": 480, "h": 320 },
  "units": "um"
}
```

The `svg` value is an SVG fragment (no `<svg>` wrapper) so the frontend can
embed it in its own coordinate system. The frontend will transform it by
position and rotation.

### `POST /design/validate`

```json
// request
{
  "placements": [ { "id": "p1", "componentId": "TransmonPocket", "name": "Q0", "x": 0, "y": 0, "rotation": 0, "params": { "pad_width": "455um" } } ],
  "connections": [ { "id": "c1", "from": { "placementId": "p1", "pinName": "readout" }, "to": { "placementId": "p2", "pinName": "tie_in" }, "routeComponentId": "RouteMeander", "routeOverrides": {} } ]
}

// response
{
  "valid": true,
  "issues": [ { "severity": "warning", "rule": "MIN_SPACING", "message": "Q0 and Q1 are 0.3 mm apart" } ]
}
```

### `POST /design/generate-code`

Same request shape. Response:

```json
{
  "language": "python",
  "filename": "design.py",
  "code": "from qiskit_metal import designs\n..."
}
```

The returned code must be self-contained and runnable with only
`pip install qiskit-metal`.

### `POST /design/render`

Same request shape. Response:

```json
{
  "svg":     "<g>...</g>",
  "viewBox": { "x": -2500, "y": -2500, "w": 5000, "h": 5000 },
  "units":   "um",
  "layers":  [ { "name": "metal", "svg": "..." }, { "name": "junctions", "svg": "..." } ],
  "routes":  [ { "connectionId": "c1", "svg": "<path .../>" } ]
}
```

`routes[i].svg` allows the frontend to overlay route geometry without
re-rendering the entire design when only a connection changes.

---

## Phase 0 validation matrix

The bridge implementation is considered ready for the editor when the
following calls succeed against the bundled `silicofeller` Qiskit Metal
installation. The `Bridge Status` panel in the editor runs these checks
on demand.

| # | Call                                                | Component            | Pass criteria                                                |
|---|-----------------------------------------------------|----------------------|--------------------------------------------------------------|
| 1 | `GET /components`                                   | —                    | Response contains all four fixture IDs                       |
| 2 | `GET /components/TransmonPocket/metadata`           | TransmonPocket       | ≥ 6 parameters, includes `pad_width`, `pad_height`           |
| 3 | `GET /components/TransmonPocket/pins`               | TransmonPocket       | ≥ 1 pin, each with `direction` and `hint`                    |
| 4 | `GET /components/TransmonPocket/preview`            | TransmonPocket       | Non-empty SVG fragment + valid `viewBox`                     |
| 5 | `GET /components/TransmonCross/metadata`            | TransmonCross        | Parameter set distinct from TransmonPocket (polymorphism)    |
| 6 | `GET /components/TransmonCross/pins`                | TransmonCross        | Pins differ from TransmonPocket                              |
| 7 | `GET /components/TransmonCross/preview`             | TransmonCross        | Non-empty SVG fragment                                       |
| 8 | `GET /components/LaunchpadWirebond/metadata`        | LaunchpadWirebond    | Category reported as IO / terminations                       |
| 9 | `GET /components/LaunchpadWirebond/pins`            | LaunchpadWirebond    | Exactly 1 pin (`tie`)                                        |
| 10| `GET /components/LaunchpadWirebond/preview`         | LaunchpadWirebond    | Non-empty SVG fragment                                       |
| 11| `GET /components/RouteMeander/metadata`             | RouteMeander         | Includes `total_length`, `meander.spacing`                   |
| 12| `POST /design/render` w/ 2 launchpads + 1 RouteMeander connection | RouteMeander | Response includes route geometry under `routes[0]`         |

All twelve checks must pass before the frontend can be considered
production-ready end-to-end.

---

## Error envelope

Any 4xx/5xx response must use the shape:

```json
{ "error": { "code": "BRIDGE_ERROR", "message": "human-readable text", "details": {} } }
```

The frontend's `bridgeClient` maps both transport errors and this envelope
into a uniform `{ data: null, error: string }` shape so call sites never have
to try/catch.

---

## CORS

The bridge is expected to set `Access-Control-Allow-Origin` to either `*` (in
development) or the deployed frontend origin (in production), and to allow
`GET, POST, OPTIONS` with `Content-Type` headers.
