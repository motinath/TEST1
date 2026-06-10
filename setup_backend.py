#!/usr/bin/env python3
"""
Silicofeller backend setup script.

Run this once after cloning:
    python setup_backend.py

It will:
  1. Create backend/.venv (Python 3.11 virtual environment)
  2. Install qiskit-metal without its incompatible GUI deps
  3. Install all required runtime dependencies
  4. Install PySide6 and create the PySide2 compatibility shim
  5. Patch qiskit_metal/__init__.py for headless operation
  6. Verify the installation works
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent
VENV = ROOT / "backend" / ".venv"
PYSIDE2_COMPAT_SRC = ROOT / "backend" / "pyside2_compat" / "__init__.py"

# ── helpers ──────────────────────────────────────────────────────────────────

def run(cmd, **kw):
    print(f"\n>>> {' '.join(str(c) for c in cmd)}")
    result = subprocess.run(cmd, **kw)
    if result.returncode != 0:
        print(f"ERROR: command failed with exit code {result.returncode}")
        sys.exit(result.returncode)

def pip(*args):
    # Always use `python -m pip` so pip can upgrade itself inside the venv.
    run([str(VENV_PYTHON), "-m", "pip", *args])

# ── locate venv python / pip ──────────────────────────────────────────────────

if sys.platform == "win32":
    VENV_PYTHON = VENV / "Scripts" / "python.exe"
else:
    VENV_PYTHON = VENV / "bin" / "python"

# ── step 1: create venv ──────────────────────────────────────────────────────

print("\n" + "="*60)
print("Step 1 — Creating virtual environment")
print("="*60)
if not VENV_PYTHON.exists():
    run([sys.executable, "-m", "venv", str(VENV)])
else:
    print("  .venv already exists, skipping creation.")

pip("install", "--upgrade", "pip", "--quiet")

# ── step 2: install qiskit-metal without GUI deps ────────────────────────────

print("\n" + "="*60)
print("Step 2 — Installing qiskit-metal (no GUI deps)")
print("="*60)
pip("install", "qiskit-metal==0.1.5", "--no-deps", "--quiet")

# ── step 3: install runtime dependencies ─────────────────────────────────────

print("\n" + "="*60)
print("Step 3 — Installing runtime dependencies")
print("="*60)

DEPS = [
    # Web server
    "fastapi>=0.110.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic>=2.6.0",
    "python-dotenv>=1.0.0",
    # Qiskit Metal runtime (version-relaxed for Python 3.11)
    "addict>=2.4.0",
    "descartes>=1.1.0",
    "gdspy>=1.6.12",
    "geopandas>=0.12.2",
    "ipython>=8.10.0",
    "matplotlib>=3.7.0,<4.0.0",
    "numpy>=1.24.0,<2.0.0",
    "pandas>=1.5.0,<3.0.0",
    "pint>=0.20.0",
    "pyEPR-quantum>=0.8.5",
    "pygments>=2.14.0",
    "pyyaml>=6.0",
    "qdarkstyle>=3.1",
    "qutip>=4.7.0",
    "scipy>=1.10.0",
    "scqubits>=3.1.0",
    "shapely>=2.0.0",
]

# Install in batches to avoid network timeouts on large packages
BATCH1 = ["fastapi", "uvicorn[standard]", "pydantic", "python-dotenv",
          "addict", "descartes", "gdspy", "geopandas"]
BATCH2 = ["matplotlib>=3.7,<4", "numpy>=1.24,<2", "pandas>=1.5,<3",
          "pint", "pygments", "pyyaml", "qdarkstyle"]
BATCH3 = ["qutip", "scipy", "scqubits", "shapely",
          "ipython", "pyEPR-quantum>=0.8.5"]

for batch in [BATCH1, BATCH2, BATCH3]:
    pip("install", *batch, "--quiet")

# ── step 4: install PySide6 + PySide2 shim ───────────────────────────────────

print("\n" + "="*60)
print("Step 4 — Installing PySide6 and PySide2 compatibility shim")
print("="*60)
print("  Note: PySide2 has no Python 3.11 wheel. We install PySide6")
print("  and create a shim that maps PySide2 imports to PySide6.")
pip("install", "PySide6", "--quiet")

# Find site-packages in the venv
site_pkgs = None
for p in VENV.rglob("site-packages"):
    if p.is_dir():
        site_pkgs = p
        break

if site_pkgs is None:
    print("ERROR: could not find site-packages in venv")
    sys.exit(1)

pyside2_dir = site_pkgs / "PySide2"
pyside2_dir.mkdir(exist_ok=True)
shutil.copy(PYSIDE2_COMPAT_SRC, pyside2_dir / "__init__.py")
print(f"  PySide2 shim installed → {pyside2_dir / '__init__.py'}")

# ── step 5: patch qiskit_metal __init__.py for headless ──────────────────────

print("\n" + "="*60)
print("Step 5 — Patching qiskit_metal for headless operation")
print("="*60)

qm_init = site_pkgs / "qiskit_metal" / "__init__.py"
if not qm_init.exists():
    print(f"ERROR: qiskit_metal not found at {qm_init}")
    sys.exit(1)

content = qm_init.read_text(encoding="utf-8")
GUARD = "    # Skip entirely when running headless (FastAPI bridge server).\n    if os.getenv('QISKIT_METAL_HEADLESS'):\n        return\n\n"
TARGET = "    # When in vscode and in debug-mode, may want to comment"

if GUARD not in content:
    if TARGET in content:
        content = content.replace(TARGET, GUARD + TARGET)
        qm_init.write_text(content, encoding="utf-8")
        print(f"  Patched: {qm_init}")
    else:
        print("  WARNING: could not find patch target — qiskit_metal version may differ.")
        print("  The bridge may fail to import. Check backend/patches/qiskit_metal_headless.patch")
else:
    print("  Already patched, skipping.")

# ── step 6: verify ───────────────────────────────────────────────────────────

print("\n" + "="*60)
print("Step 6 — Verifying installation")
print("="*60)

env = os.environ.copy()
env["QISKIT_METAL_HEADLESS"] = "1"

result = subprocess.run(
    [str(VENV_PYTHON), "-c",
     "import qiskit_metal; from qiskit_metal import designs, qlibrary; "
     "d = designs.DesignPlanar(enable_renderers=False); "
     "print('qiskit_metal', qiskit_metal.__version__, '— OK')"],
    capture_output=True, text=True, env=env
)
if result.returncode == 0:
    print(f"  {result.stdout.strip()}")
else:
    print("  FAILED:")
    print(result.stderr[-500:])
    sys.exit(1)

result2 = subprocess.run(
    [str(VENV_PYTHON), "-c", "import fastapi, uvicorn, pydantic; print('FastAPI OK')"],
    capture_output=True, text=True,
)
if result2.returncode == 0:
    print(f"  {result2.stdout.strip()}")
else:
    print("  FastAPI install check FAILED:", result2.stderr[-200:])
    sys.exit(1)

# ── done ─────────────────────────────────────────────────────────────────────

print("\n" + "="*60)
print("Setup complete!")
print("="*60)
print()
print("To start the bridge:")
if sys.platform == "win32":
    print("  backend\\.venv\\Scripts\\Activate.ps1")
    print("  $env:QISKIT_METAL_HEADLESS='1'")
else:
    print("  source backend/.venv/bin/activate")
    print("  export QISKIT_METAL_HEADLESS=1")
print("  python -m backend.start")
print()
print("Then open a second terminal and run the frontend:")
print("  npm install   # first time only")
print("  npm run dev")
print()
print("Open http://localhost:3000 in your browser.")
