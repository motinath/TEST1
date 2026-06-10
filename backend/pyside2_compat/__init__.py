# PySide2 compatibility shim for qiskit-metal on Python 3.11+
# Maps PySide2 sub-module imports to PySide6.
# The bridge runs with QISKIT_METAL_HEADLESS=1 so Qt is never initialised —
# we only need these modules to be importable without error.
#
# Installed by setup.py into the venv site-packages as PySide2/__init__.py

import sys
import types


def _build_qtcore():
    from PySide6 import QtCore as _src
    mod = types.ModuleType("PySide2.QtCore")
    mod.__dict__.update({k: getattr(_src, k) for k in dir(_src) if not k.startswith("__")})
    mod.__version__ = getattr(_src, "__version__", "5.15.2")
    return mod


def _build_qtgui():
    from PySide6 import QtGui as _src
    mod = types.ModuleType("PySide2.QtGui")
    mod.__dict__.update({k: getattr(_src, k) for k in dir(_src) if not k.startswith("__")})
    return mod


def _build_qtwidgets():
    from PySide6 import QtWidgets as _src
    from PySide6 import QtGui as _gui
    mod = types.ModuleType("PySide2.QtWidgets")
    mod.__dict__.update({k: getattr(_src, k) for k in dir(_src) if not k.startswith("__")})
    for _name in ("QAction", "QActionGroup", "QShortcut"):
        if hasattr(_gui, _name) and not hasattr(_src, _name):
            mod.__dict__[_name] = getattr(_gui, _name)
    return mod


def _build_qtsvg():
    from PySide6 import QtSvg as _src
    mod = types.ModuleType("PySide2.QtSvg")
    mod.__dict__.update({k: getattr(_src, k) for k in dir(_src) if not k.startswith("__")})
    return mod


_registry = {
    "PySide2.QtCore":    _build_qtcore,
    "PySide2.QtGui":     _build_qtgui,
    "PySide2.QtWidgets": _build_qtwidgets,
    "PySide2.QtSvg":     _build_qtsvg,
}

for _key, _builder in _registry.items():
    if _key not in sys.modules:
        try:
            sys.modules[_key] = _builder()
        except Exception:
            sys.modules[_key] = types.ModuleType(_key)

__version__ = "5.15.2"
PYSIDE_VERSION_STR = __version__
