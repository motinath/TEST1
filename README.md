# Silicofeller — Qiskit Metal Schematic Editor

Visual drag-and-drop editor for superconducting quantum chip design.
Every component shape, pin position, parameter, and generated Python script
comes from the live Qiskit Metal installation — nothing is hardcoded.

---

## How to run

You need **two terminals** — one for the backend bridge, one for the frontend.

---

### Terminal 1 — Start the backend bridge

```powershell
cd s:\edit\editor-master

# Activate the virtual environment
backend\.venv\Scripts\Activate.ps1

# Start the bridge (runs on http://localhost:8000)
$env:QISKIT_METAL_HEADLESS="1"
python -m backend.start
```

**Verify it is working:**

Open a second PowerShell and run:

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Expected output:
```
status  version  cache
------  -------  -----
ok      0.1.0    @{entries=1}
```

Wait ~10–30 seconds for component discovery, then:

```powershell
Invoke-RestMethod http://localhost:8000/components | Format-Table id, category
```

You should see 40+ real Qiskit Metal components like `TransmonPocket`, `RouteMeander`, etc.

---

### Terminal 2 — Start the frontend

```powershell
cd s:\edit\editor-master

# Install node dependencies (first time only)
npm install

# Start the dev server
npm run dev
```

Then open your browser at:

```
http://localhost:3000
```

Click **Open Schematic Editor** → you should see the component library loaded
from the live bridge, not mock data.

---

## What you will see

| UI element | Where it comes from |
|------------|---------------------|
| Component Library panel | `GET /components` — real qiskit_metal.qlibrary scan |
| Parameter fields (Property Inspector) | `GET /components/{id}/metadata` — from `default_options` |
| Pin handles on canvas | `GET /components/{id}/pins` — from throwaway QComponent instantiation |
| Component shape preview | `GET /components/{id}/preview` — Shapely → SVG |
| Full chip render | `POST /design/render` — QMplRenderer → SVG |
| Generated Python | `POST /design/generate-code` — self-contained Qiskit Metal script |

---

## Verify all outputs come from the bridge

In the editor, click the **Bridge Status** tab in the bottom panel,
then click **Run Phase 0**.

All 13+ checks should go green. Green = data from live Qiskit Metal.

---

## Quick API test (curl / PowerShell)

```powershell
# Health check
Invoke-RestMethod http://localhost:8000/health

# List all components
Invoke-RestMethod http://localhost:8000/components | Select id, category | Format-Table

# TransmonPocket parameters (from default_options)
Invoke-RestMethod "http://localhost:8000/components/TransmonPocket/metadata"

# TransmonPocket pin positions (in mm)
Invoke-RestMethod "http://localhost:8000/components/TransmonPocket/pins"

# TransmonPocket SVG preview
Invoke-RestMethod "http://localhost:8000/components/TransmonPocket/preview"

# Generate Python code for a minimal design
$body = '{"placements":[{"id":"p1","componentId":"TransmonPocket","name":"Q0","x":0,"y":0,"rotation":0,"params":{"pad_width":"455um"}}],"connections":[]}'
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/design/generate-code" -Body $body -ContentType "application/json"
```

---

## Troubleshooting

**Bridge fails to start — `ModuleNotFoundError: No module named 'PySide2'`**

Make sure you set the headless env variable before starting:
```powershell
$env:QISKIT_METAL_HEADLESS="1"
python -m backend.start
```

**`Activate.ps1` is blocked by execution policy**

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then re-run the activate command.

**Frontend shows yellow "Development preview" banner**

The bridge URL is not configured. Make sure:
1. The backend is running on port 8000
2. The `.env` file exists at the project root with:
   ```
   VITE_BRIDGE_URL=http://localhost:8000
   ```

Copy the example if it does not exist:
```powershell
Copy-Item .env.example .env
```

**Component list is empty or slow on first load**

Normal — qiskit_metal.qlibrary scan takes 10–60 seconds on first request.
Subsequent requests are instant (cached). The prewarm runs in the background
at startup so by the time you open the browser it is usually ready.

---

## Project layout

```
editor-master/
├── backend/                  ← FastAPI bridge (Python)
│   ├── .venv/                ← Virtual environment (created during setup)
│   ├── app.py                ← FastAPI app, CORS, error handlers
│   ├── start.py              ← Entry point (python -m backend.start)
│   ├── requirements.txt      ← Python dependencies
│   ├── services/
│   │   ├── component_registry.py  ← scans qiskit_metal.qlibrary
│   │   ├── metadata_service.py    ← reads QComponent.default_options
│   │   ├── pin_service.py         ← instantiates QComponent, reads .pins
│   │   ├── render_service.py      ← Shapely SVG + matplotlib SVG
│   │   └── codegen_service.py     ← generates Python script
│   ├── routes/               ← HTTP endpoints
│   ├── models/               ← Pydantic models
│   └── cache/                ← in-memory cache
│
├── src/                      ← React/TypeScript frontend
│   ├── components/quantum-editor/
│   │   ├── editor-canvas.tsx      ← SVG canvas, drag-drop, pan-zoom
│   │   ├── editor-toolbar.tsx     ← New/Save/Load/Render/Generate buttons
│   │   ├── property-inspector.tsx ← dynamic param editor
│   │   ├── component-library.tsx  ← component list from bridge
│   │   ├── code-panel.tsx         ← syntax-highlighted generated code
│   │   ├── bottom-panel.tsx       ← Console/Validation/Code/Bridge tabs
│   │   └── bridge-status.tsx      ← Phase 0 validation checklist
│   └── lib/bridge/
│       ├── client.ts         ← HTTP client
│       ├── queries.ts        ← TanStack Query options
│       ├── types.ts          ← TypeScript contract
│       └── mock.ts           ← fallback when bridge not running
│
├── .env.example              ← copy to .env and set VITE_BRIDGE_URL
└── README.md                 ← this file
```
