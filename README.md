# Silicofeller — Qiskit Metal Schematic Editor

Visual drag-and-drop schematic editor for superconducting quantum chip design.
Every component, parameter, pin, shape, and generated Python script comes from
the live Qiskit Metal installation — nothing is hardcoded in the frontend.

---

## Quick start (clone and run)

### Requirements
- Python 3.11
- Node.js 18+
- Git

### Step 1 — Clone

```bash
git clone https://github.com/motinath/TEST1.git
cd TEST1
```

### Step 2 — Set up the backend (one time only)

```bash
python setup_backend.py
```

This single command:
- Creates `backend/.venv` virtual environment
- Installs qiskit-metal 0.1.5 without the incompatible GUI dependency (PySide2)
- Installs all runtime dependencies (FastAPI, numpy, scipy, shapely, geopandas…)
- Installs PySide6 and creates a PySide2→PySide6 compatibility shim
- Patches qiskit-metal for headless server operation
- Verifies the installation works

Takes 2–5 minutes depending on download speed.

### Step 3 — Configure the frontend

```bash
cp .env.example .env
```

The `.env` file contains:
```
VITE_BRIDGE_URL=http://localhost:8000
```

### Step 4 — Install frontend dependencies (one time only)

```bash
npm install
```

### Step 5 — Start both services (two terminals)

**Terminal 1 — Backend bridge:**

```powershell
# Windows PowerShell
backend\.venv\Scripts\Activate.ps1
$env:QISKIT_METAL_HEADLESS="1"
python -m backend.start
```

```bash
# Linux / macOS
source backend/.venv/bin/activate
export QISKIT_METAL_HEADLESS=1
python -m backend.start
```

Wait for: `Uvicorn running on http://0.0.0.0:8000`

**Terminal 2 — Frontend:**

```bash
npm run dev
```

### Step 6 — Open the editor

```
http://localhost:3000
```

Click **Open Schematic Editor**.
The component library loads 40+ real Qiskit Metal components.
The yellow "Development preview" banner is gone.

---

## What you see when everything is working

| UI element | Data source |
|------------|-------------|
| Component Library | `GET /components` — live `qiskit_metal.qlibrary` scan |
| Component thumbnails | `GET /components/{id}/preview` — real Shapely geometry SVG |
| Parameter fields | `GET /components/{id}/metadata` — from `QComponent.default_options` |
| Pin handles on canvas | `GET /components/{id}/pins` — from throwaway QComponent instantiation |
| Full chip render | `POST /design/render` — QMplRenderer → SVG |
| Generated Python | `POST /design/generate-code` — self-contained Qiskit Metal script |

---

## Verify bridge is working

```powershell
# Health check
Invoke-RestMethod http://localhost:8000/health

# Component list (40+ components expected)
Invoke-RestMethod http://localhost:8000/components | Format-Table id, category

# TransmonPocket parameters from default_options
Invoke-RestMethod http://localhost:8000/components/TransmonPocket/metadata

# Pin positions in mm
Invoke-RestMethod http://localhost:8000/components/TransmonPocket/pins

# SVG preview (should return ~500 chars of path data)
$r = Invoke-RestMethod http://localhost:8000/components/TransmonPocket/preview
Write-Host "SVG length:" $r.svg.Length
```

In the editor, click **Bridge Status** tab → **Run Phase 0** — all checks should go green.

---

## Architecture

```
Browser (React + TypeScript)
        │
        │  JSON over HTTP
        ▼
FastAPI Bridge (Python)
        │
        │  Python API
        ▼
Qiskit Metal + Shapely
        │
        ├── Component discovery  (pkgutil.walk_packages)
        ├── Metadata             (QComponent.default_options)
        ├── Pins                 (throwaway DesignPlanar instantiation)
        ├── SVG previews         (Shapely → SVG fragment, subprocess-isolated)
        ├── Full render          (QMplRenderer → matplotlib SVG, subprocess-isolated)
        └── Code generation      (standalone Python script from DesignDocument JSON)
```

The frontend stores only:
```json
{
  "placements": [
    {"id": "p1", "componentId": "TransmonPocket", "name": "Q0",
     "x": 0, "y": 0, "rotation": 0, "params": {"pad_width": "455um"}}
  ],
  "connections": [
    {"id": "c1", "from": {"placementId": "p1", "pinName": "a"},
     "to": {"placementId": "p2", "pinName": "b"}, "routeComponentId": "RouteMeander"}
  ]
}
```

Nothing else. All geometry, parameters, and code generation happen in the backend.

---

## Project layout

```
TEST1/
├── setup_backend.py          ← Run this first — sets up everything automatically
├── .env.example              ← Copy to .env
├── README.md
│
├── backend/                  ← FastAPI bridge (Python)
│   ├── pyside2_compat/       ← PySide2→PySide6 shim (installed by setup_backend.py)
│   ├── patches/              ← Patch for qiskit-metal headless operation
│   ├── app.py                ← FastAPI app
│   ├── start.py              ← Entry point: python -m backend.start
│   ├── requirements.txt      ← Python deps reference
│   ├── services/
│   │   ├── component_registry.py  ← Scans qiskit_metal.qlibrary
│   │   ├── metadata_service.py    ← Reads QComponent.default_options
│   │   ├── pin_service.py         ← Instantiates QComponent, reads .pins
│   │   ├── render_service.py      ← Shapely→SVG + matplotlib full render
│   │   └── codegen_service.py     ← Generates standalone Python script
│   ├── routes/               ← HTTP endpoints
│   ├── models/               ← Pydantic models
│   └── cache/                ← In-memory cache
│
├── src/                      ← React/TypeScript frontend
│   ├── components/quantum-editor/
│   │   ├── editor-canvas.tsx      ← SVG canvas, drag-drop, pan/zoom
│   │   ├── editor-toolbar.tsx     ← New/Save/Load/Render/Validate/Generate
│   │   ├── property-inspector.tsx ← Dynamic param editor (from bridge metadata)
│   │   ├── component-library.tsx  ← Component list + thumbnails (from bridge)
│   │   ├── code-panel.tsx         ← Syntax-highlighted generated code
│   │   ├── bottom-panel.tsx       ← Console/Validation/Code/Bridge-Status tabs
│   │   └── bridge-status.tsx      ← Phase 0 validation checklist
│   └── lib/bridge/
│       ├── client.ts         ← HTTP client (live bridge or mock fallback)
│       ├── queries.ts        ← TanStack Query options
│       ├── types.ts          ← TypeScript contract (mirrors Pydantic models)
│       └── mock.ts           ← Dev fixtures (only when bridge not configured)
│
└── docs/
    ├── bridge-contract.md    ← Full API contract
    └── geometry-strategy.md  ← SVG transport design
```

---

## Troubleshooting

**`Activate.ps1` is blocked by execution policy (Windows)**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Bridge fails — `ModuleNotFoundError`**
Make sure `$env:QISKIT_METAL_HEADLESS="1"` is set before starting the bridge.

**Component list is slow on first load**
Normal — qiskit_metal.qlibrary scan takes 10–60 s on first request.
Results are cached; subsequent calls are instant.

**Frontend shows "Development preview" banner**
The backend is not running or `.env` is missing.
Check: `Invoke-RestMethod http://localhost:8000/health`

**Component thumbnails show icons instead of shapes**
Routes (RouteMeander etc.) have no standalone geometry — they need two
connected pins to generate a path. This is correct. Qubit components
(TransmonPocket, TransmonCross, etc.) show real Shapely geometry.

---

## Backend environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QISKIT_METAL_HEADLESS` | — | **Required.** Set to `1` to skip Qt GUI init |
| `BRIDGE_HOST` | `0.0.0.0` | Bind address |
| `BRIDGE_PORT` | `8000` | Bind port |
| `BRIDGE_LOG_LEVEL` | `info` | `debug` / `info` / `warning` / `error` |
| `BRIDGE_CACHE_TTL` | `0` | Cache TTL seconds (`0` = never expire) |
