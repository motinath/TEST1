# Silicofeller Bridge

FastAPI backend that wraps Qiskit Metal and exposes a REST API
for the Silicofeller schematic editor frontend.

---

## How to start

```powershell
# From the project root  s:\edit\editor-master
backend\.venv\Scripts\Activate.ps1

$env:QISKIT_METAL_HEADLESS="1"
python -m backend.start
```

The server starts on `http://localhost:8000`.

> **Why `QISKIT_METAL_HEADLESS=1`?**
> qiskit-metal 0.1.5 tries to launch a PySide2 Qt window on import.
> This env variable skips that — the bridge is a headless HTTP server
> and never opens a GUI.

---

## Endpoints

| Method | Path | Returns |
|--------|------|---------|
| `GET` | `/health` | `{status, version, cache}` |
| `POST` | `/admin/refresh` | Clears cache, re-scans qlibrary |
| `GET` | `/components` | All discovered QComponent subclasses |
| `GET` | `/components/{id}` | Single component summary |
| `GET` | `/components/{id}/metadata` | Parameters from `default_options` |
| `GET` | `/components/{id}/pins` | Pin positions in mm |
| `GET` | `/components/{id}/preview` | Shapely SVG fragment |
| `POST` | `/design/validate` | DRC checks |
| `POST` | `/design/render` | Full chip matplotlib SVG |
| `POST` | `/design/generate-code` | Standalone Qiskit Metal Python script |

---

## Test the endpoints

```powershell
# Health
Invoke-RestMethod http://localhost:8000/health

# All components (43 total)
Invoke-RestMethod http://localhost:8000/components | Format-Table id, category

# TransmonPocket parameters
Invoke-RestMethod http://localhost:8000/components/TransmonPocket/metadata

# TransmonPocket pin positions (mm)
Invoke-RestMethod http://localhost:8000/components/TransmonPocket/pins

# TransmonPocket SVG preview
Invoke-RestMethod http://localhost:8000/components/TransmonPocket/preview

# Generate Python for a 1-qubit design
$body = @'
{
  "placements": [
    {"id":"p1","componentId":"TransmonPocket","name":"Q0",
     "x":0,"y":0,"rotation":0,"params":{"pad_width":"455um","pad_height":"90um"}}
  ],
  "connections": []
}
'@
Invoke-RestMethod -Method Post -Uri "http://localhost:8000/design/generate-code" `
  -Body $body -ContentType "application/json"

# Refresh component cache (no restart needed after qlibrary changes)
Invoke-RestMethod -Method Post http://localhost:8000/admin/refresh
```

---

## Virtual environment setup (first time only)

The `.venv` was created with:

```powershell
python -m venv backend/.venv
backend\.venv\Scripts\Activate.ps1
pip install qiskit-metal==0.1.5 --no-deps
pip install fastapi "uvicorn[standard]" pydantic python-dotenv
pip install matplotlib "numpy<2" "pandas<3" shapely geopandas
pip install scipy scqubits qutip addict gdspy descartes
pip install "pyEPR-quantum>=0.8" qdarkstyle pint pygments pyyaml
pip install PySide6
```

`PySide2` is not available for Python 3.11. A compatibility shim is installed at:
```
backend/.venv/Lib/site-packages/PySide2/__init__.py
```
This maps `PySide2` imports to `PySide6` for the Qt symbols qiskit-metal needs.

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `QISKIT_METAL_HEADLESS` | `""` | Set to `1` — required for headless operation |
| `BRIDGE_HOST` | `0.0.0.0` | Bind address |
| `BRIDGE_PORT` | `8000` | Bind port |
| `BRIDGE_LOG_LEVEL` | `info` | `debug` / `info` / `warning` / `error` |
| `BRIDGE_CACHE_TTL` | `0` | Cache TTL seconds, `0` = never expire |

---

## Services

| File | What it does |
|------|-------------|
| `services/component_registry.py` | `pkgutil.walk_packages` scan of `qiskit_metal.qlibrary` |
| `services/metadata_service.py` | Reads `QComponent.default_options`, returns `ParameterSpec[]` |
| `services/pin_service.py` | Instantiates throwaway `DesignPlanar`, reads `component.pins`, returns mm coords |
| `services/render_service.py` | Subprocess-isolated Shapely→SVG (per component) and QMplRenderer→SVG (full design) |
| `services/codegen_service.py` | Builds self-contained Python script from `DesignDocument` |
