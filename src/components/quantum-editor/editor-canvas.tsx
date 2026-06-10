/**
 * EditorCanvas — EDA-style schematic canvas.
 *
 * Architecture:
 * - Placement mode: click library item → ghost follows cursor → click canvas → placed.
 *   No HTML drag-and-drop. No browser ghost images.
 * - Move mode: pointer down on component → local ref tracks position →
 *   single store dispatch on pointer up. Zero store updates during movement.
 * - Render calls: disabled while any drag/move is active.
 * - PlacementGlyph, PlacementPreview, ConnectionLine: all React.memo'd.
 *   Only moved components re-render.
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  memo,
} from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Minus, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import {
  useDesignStore,
  prefixForCategory,
  type EditorState,
} from "@/lib/editor/design-store";
import {
  componentPinsQueryOptions,
  componentPreviewQueryOptions,
  componentsQueryOptions,
} from "@/lib/bridge/queries";
import { defaultParamsFromMetadata } from "@/lib/bridge/adapters";
import { bridgeClient, isBridgeConfigured } from "@/lib/bridge/client";
import type {
  ComponentSummary,
  PinSpec,
  Placement,
  RenderResult,
} from "@/lib/bridge/types";
import { cn } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────
const MM_TO_PX = 80;   // 80 screen pixels per mm at zoom=1
const UM_TO_MM = 0.001;
const SNAP_MM  = 0.05; // 50 µm grid snap

// ── Coordinate helpers (pure functions, no React) ────────────────────────────
function worldToScreenFn(
  x: number, y: number,
  w: number, h: number,
  pan: { x: number; y: number },
  zoom: number,
) {
  return {
    px: w / 2 + (x * MM_TO_PX + pan.x) * zoom,
    py: h / 2 - (y * MM_TO_PX - pan.y) * zoom,
  };
}

function screenToWorldFn(
  px: number, py: number,
  w: number, h: number,
  pan: { x: number; y: number },
  zoom: number,
) {
  return {
    x: (px - w / 2) / zoom / MM_TO_PX - pan.x / MM_TO_PX,
    y: -(py - h / 2) / zoom / MM_TO_PX + pan.y / MM_TO_PX,
  };
}

function snap(v: number) {
  return Math.round(v / SNAP_MM) * SNAP_MM;
}

// ── Types ────────────────────────────────────────────────────────────────────
type PanDrag = {
  mode: "pan";
  startX: number; startY: number;
  panX: number;   panY: number;
};
type MoveDrag = {
  mode: "move";
  id: string;
  startClientX: number; startClientY: number;
  startWorldX: number;  startWorldY: number;
};
type ActiveDrag = PanDrag | MoveDrag | null;

// ── Main canvas ──────────────────────────────────────────────────────────────
export function EditorCanvas() {
  const { state, dispatch, doc, uniqueName } = useDesignStore();
  const queryClient = useQueryClient();
  const svgRef       = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // ── Local drag state (ref — never triggers React re-renders during move) ──
  const activeDragRef = useRef<ActiveDrag>(null);
  // Temporary SVG transform applied to the moving glyph via DOM directly.
  const movingGlyphRef = useRef<SVGGElement | null>(null);
  // Current live position during move (used on pointer-up commit).
  const livePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Ghost cursor position during placement mode.
  const [ghostPos, setGhostPos] = useState<{ px: number; py: number } | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const componentsQ = useQuery(componentsQueryOptions());
  const componentsById = useMemo(() => {
    const map = new Map<string, ComponentSummary>();
    (componentsQ.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [componentsQ.data]);

  // Default route component from live registry.
  const defaultRouteComponent = useMemo(() => {
    const routes = (componentsQ.data ?? []).filter((c) => c.category === "routes");
    return routes.find((c) => c.id === "RouteMeander")?.id ?? routes[0]?.id ?? "RouteMeander";
  }, [componentsQ.data]);

  // Bridge render — disabled while dragging (ref, not state, so no re-render needed).
  const isDraggingRef = useRef(false);
  const renderQ = useQuery({
    queryKey: ["bridge", "render", doc],
    queryFn: ({ signal }) =>
      bridgeClient.renderDesign(doc, signal).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    enabled: isBridgeConfigured() && doc.placements.length > 0 && !isDraggingRef.current,
    staleTime: 0,
  });

  // Per-placement pin queries — loaded once, cached, never refetched during drag.
  const pinQueries = useQueries({
    queries: state.placements.map((p) => ({
      ...componentPinsQueryOptions(p.componentId),
      // staleTime: DAY already set in queries.ts — pins never refetched.
    })),
  });

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setSize({ w: el.clientWidth, h: el.clientHeight }),
    );
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── Stable coordinate helpers (memoised on pan/zoom/size) ─────────────────
  const worldToScreen = useCallback(
    (x: number, y: number) =>
      worldToScreenFn(x, y, size.w, size.h, state.pan, state.zoom),
    [size, state.pan, state.zoom],
  );

  const screenToWorld = useCallback(
    (px: number, py: number) =>
      screenToWorldFn(px, py, size.w, size.h, state.pan, state.zoom),
    [size, state.pan, state.zoom],
  );

  // ── Scroll-to-zoom ────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      dispatch({ type: "ZOOM", zoom: state.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [dispatch, state.zoom]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dispatch({ type: "CANCEL_PIN" }); // also exits placement mode
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        state.selection &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        if (state.selection.kind === "placement")
          dispatch({ type: "DELETE_PLACEMENT", id: state.selection.id });
        else
          dispatch({ type: "DELETE_CONNECTION", id: state.selection.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, state.selection]);

  // ── Pointer handlers ──────────────────────────────────────────────────────

  /** Canvas background click — either place component or deselect. */
  const handleCanvasClick = useCallback(
    async (e: React.MouseEvent<SVGSVGElement>) => {
      const target = e.target as Element;
      const isBg =
        target === e.currentTarget ||
        target.getAttribute("data-canvas-bg") === "true";
      if (!isBg) return;

      // ── Placement mode: commit new component ──
      if (state.placingComponentId) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        const x = parseFloat(snap(w.x).toFixed(3));
        const y = parseFloat(snap(w.y).toFixed(3));
        const componentId = state.placingComponentId;
        const summary = componentsById.get(componentId);
        if (!summary) return;

        // Fetch/use cached metadata for default params.
        const metaRes = await bridgeClient.getMetadata(componentId);
        let params: Record<string, string> = {};
        if (metaRes.data) {
          params = defaultParamsFromMetadata(metaRes.data);
        } else {
          toast.warning(`Could not load parameters for ${componentId} — placed with defaults.`);
        }

        const name = uniqueName(prefixForCategory(summary.category));
        const placement: Placement = {
          id: `pl_${name}_${Date.now()}`,
          componentId,
          name,
          x,
          y,
          rotation: 0,
          params,
        };
        dispatch({ type: "ADD_PLACEMENT", placement });
        // Stay in placement mode so user can place multiple instances.
        // Exit with Escape or second click on same library item.
        return;
      }

      // ── Select mode: deselect ──
      dispatch({ type: "SELECT", selection: null });
    },
    [state.placingComponentId, componentsById, screenToWorld, uniqueName, dispatch],
  );

  /** Canvas pointer-down — start pan. */
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const target = e.target as Element;
      const isBg =
        target === e.currentTarget ||
        target.getAttribute("data-canvas-bg") === "true";

      if ((isBg && !state.placingComponentId) || state.tool === "pan") {
        activeDragRef.current = {
          mode: "pan",
          startX: e.clientX, startY: e.clientY,
          panX: state.pan.x,  panY: state.pan.y,
        };
        isDraggingRef.current = true;
        dispatch({ type: "SELECT", selection: null });
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      }
    },
    [state.placingComponentId, state.tool, state.pan, dispatch],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      // Update ghost position for placement mode.
      if (state.placingComponentId) {
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const w = screenToWorldFn(localX, localY, size.w, size.h, state.pan, state.zoom);
        const snappedW = worldToScreenFn(snap(w.x), snap(w.y), size.w, size.h, state.pan, state.zoom);
        setGhostPos({ px: snappedW.px, py: snappedW.py });
      }

      const drag = activeDragRef.current;
      if (!drag) return;

      if (drag.mode === "pan") {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        dispatch({
          type: "PAN",
          x: drag.panX + dx / state.zoom,
          y: drag.panY - dy / state.zoom,
        });
      } else if (drag.mode === "move") {
        // ── Local move: update glyph transform directly via DOM (no React re-render) ──
        const dx = (e.clientX - drag.startClientX) / state.zoom / MM_TO_PX;
        const dy = -(e.clientY - drag.startClientY) / state.zoom / MM_TO_PX;
        const rawX = drag.startWorldX + dx;
        const rawY = drag.startWorldY + dy;
        const sx = snap(rawX);
        const sy = snap(rawY);
        livePos.current = { x: sx, y: sy };

        // Move only the active glyph group via direct DOM transform.
        if (movingGlyphRef.current) {
          const screen = worldToScreenFn(sx, sy, size.w, size.h, state.pan, state.zoom);
          const el = movingGlyphRef.current;
          // Keep existing rotation, just update translate.
          const rot = el.getAttribute("data-rotation") ?? "0";
          el.setAttribute("transform", `translate(${screen.px} ${screen.py}) rotate(${rot})`);
        }
      }
    },
    [state.placingComponentId, state.pan, state.zoom, size, dispatch],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (activeDragRef.current && (e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
        (e.currentTarget as Element).releasePointerCapture(e.pointerId);
      }
      const drag = activeDragRef.current;
      activeDragRef.current = null;
      isDraggingRef.current = false;
      movingGlyphRef.current = null;

      if (drag?.mode === "move") {
        // Single store commit — only now does React re-render.
        dispatch({
          type: "MOVE_PLACEMENT",
          id: drag.id,
          x: parseFloat(livePos.current.x.toFixed(3)),
          y: parseFloat(livePos.current.y.toFixed(3)),
        });
        // Invalidate render cache after move.
        queryClient.invalidateQueries({ queryKey: ["bridge", "render"] });
      }
    },
    [dispatch, queryClient],
  );

  /** Called by PlacementGlyph on pointer-down to start a move. */
  const startMove = useCallback(
    (e: React.PointerEvent, placement: Placement, glyphEl: SVGGElement) => {
      e.stopPropagation();
      if (state.tool === "pan" || state.placingComponentId) return;
      dispatch({ type: "SELECT", selection: { kind: "placement", id: placement.id } });
      activeDragRef.current = {
        mode: "move",
        id: placement.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startWorldX: placement.x,
        startWorldY: placement.y,
      };
      isDraggingRef.current = true;
      livePos.current = { x: placement.x, y: placement.y };
      movingGlyphRef.current = glyphEl;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    },
    [state.tool, state.placingComponentId, dispatch],
  );

  const fitView = () => {
    dispatch({ type: "ZOOM", zoom: 1 });
    dispatch({ type: "PAN", x: 0, y: 0 });
  };

  // ── Determine cursor ──────────────────────────────────────────────────────
  const cursor = state.placingComponentId
    ? "crosshair"
    : state.tool === "pan"
      ? (activeDragRef.current?.mode === "pan" ? "grabbing" : "grab")
      : "default";

  // ── Chip boundary in screen coords ────────────────────────────────────────
  const chipTL = worldToScreen(-4.5, 3);
  const chipBR = worldToScreen(4.5, -3);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="block touch-none select-none"
        style={{
          cursor,
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--foreground) 15%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * state.zoom}px ${24 * state.zoom}px`,
          backgroundPosition: `${state.pan.x * state.zoom + size.w / 2}px ${-state.pan.y * state.zoom + size.h / 2}px`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleCanvasClick}
      >
        {/* Transparent hit area */}
        <rect data-canvas-bg="true" x={0} y={0} width={size.w} height={size.h} fill="transparent" />

        {/* Chip boundary guide — 9 mm × 6 mm */}
        <rect
          x={chipTL.px} y={chipTL.py}
          width={chipBR.px - chipTL.px} height={chipBR.py - chipTL.py}
          fill="none"
          stroke="color-mix(in oklab, var(--foreground) 20%, transparent)"
          strokeWidth={1.5}
          strokeDasharray="8 5"
          rx={3}
        />

        {/* ── Layer order (bottom → top):
              1. PlacementPreview   per-component Shapely SVG
              2. BridgeRender       full-design matplotlib SVG
              3. ConnectionLine     placeholder CPW lines
              4. PlacementGlyph    hit areas + pin handles (always top)
              5. PlacementGhost    placement-mode cursor preview
        */}

        {/* 1 — Shapely previews */}
        {state.placements.map((p) => (
          <MemoPlacementPreview
            key={p.id}
            placement={p}
            pan={state.pan}
            zoom={state.zoom}
            size={size}
          />
        ))}

        {/* 2 — Full bridge render */}
        {renderQ.data?.svg && (
          <BridgeRender result={renderQ.data} state={state} worldToScreen={worldToScreen} />
        )}

        {/* 3 — Connection lines */}
        {state.connections.map((c) => {
          const aIdx = state.placements.findIndex((x) => x.id === c.from.placementId);
          const bIdx = state.placements.findIndex((x) => x.id === c.to.placementId);
          if (aIdx === -1 || bIdx === -1) return null;
          const a = state.placements[aIdx];
          const b = state.placements[bIdx];
          const aPins = pinQueries[aIdx]?.data?.pins ?? null;
          const bPins = pinQueries[bIdx]?.data?.pins ?? null;
          const aO = worldToScreen(a.x, a.y);
          const bO = worldToScreen(b.x, b.y);

          let sp: { px: number; py: number } | null = null;
          let ep: { px: number; py: number } | null = null;

          if (aPins) {
            const pin = aPins.find((p) => p.name === c.from.pinName);
            if (!pin) return null;
            sp = { px: aO.px + pin.hint.x * MM_TO_PX * state.zoom, py: aO.py - pin.hint.y * MM_TO_PX * state.zoom };
          } else { sp = aO; }

          if (bPins) {
            const pin = bPins.find((p) => p.name === c.to.pinName);
            if (!pin) return null;
            ep = { px: bO.px + pin.hint.x * MM_TO_PX * state.zoom, py: bO.py - pin.hint.y * MM_TO_PX * state.zoom };
          } else { ep = bO; }

          if (!sp || !ep) return null;

          return (
            <MemoConnectionLine
              key={c.id}
              id={c.id}
              routeComponentId={c.routeComponentId}
              startPt={sp}
              endPt={ep}
              selected={state.selection?.kind === "connection" && state.selection.id === c.id}
              onSelect={() => dispatch({ type: "SELECT", selection: { kind: "connection", id: c.id } })}
            />
          );
        })}

        {/* 4 — Placement glyphs */}
        {state.placements.map((p, i) => (
          <MemoPlacementGlyph
            key={p.id}
            placement={p}
            pins={pinQueries[i]?.data?.pins ?? []}
            selected={state.selection?.kind === "placement" && state.selection.id === p.id}
            pendingPlacementId={state.pendingPin?.placementId ?? null}
            pendingPin={state.pendingPin?.pinName ?? null}
            pan={state.pan}
            zoom={state.zoom}
            size={size}
            onStartMove={startMove}
            onPinClick={(pinName) =>
              dispatch({
                type: "PIN_CLICK",
                placementId: p.id,
                pinName,
                defaultRouteComponentId: defaultRouteComponent,
              })
            }
          />
        ))}

        {/* 5 — Placement ghost */}
        {state.placingComponentId && ghostPos && (
          <PlacementGhost
            componentId={state.placingComponentId}
            px={ghostPos.px}
            py={ghostPos.py}
            zoom={state.zoom}
          />
        )}
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-border bg-card/95 px-1 py-1 shadow-sm backdrop-blur">
        <button type="button" onClick={() => dispatch({ type: "ZOOM", zoom: state.zoom / 1.2 })}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[44px] text-center text-[11px] font-bold text-foreground">
          {Math.round(state.zoom * 100)}%
        </span>
        <button type="button" onClick={() => dispatch({ type: "ZOOM", zoom: state.zoom * 1.2 })}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={fitView}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          title="Fit view">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Status banners */}
      {state.placingComponentId && (
        <div className="absolute left-3 top-3 rounded-full border border-primary/40 bg-primary/15 px-3 py-1 text-[11px] font-bold text-primary shadow-sm">
          Click canvas to place · Esc to cancel
        </div>
      )}
      {!state.placingComponentId && state.pendingPin && (
        <div className="absolute left-3 top-3 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary shadow-sm">
          Click another pin to connect · Esc to cancel
        </div>
      )}
      {state.placements.length === 0 && !state.placingComponentId && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-dashed border-border bg-card/70 px-6 py-4 text-center text-xs text-muted-foreground">
            {isBridgeConfigured()
              ? "Click a component in the library to begin placing."
              : "Dev preview — click a component in the library to begin."}
          </div>
        </div>
      )}
      {renderQ.isError && (
        <div className="absolute bottom-3 left-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1 text-[10px] text-destructive">
          Render failed: {String(renderQ.error)}
        </div>
      )}
    </div>
  );
}

// ── Bridge SVG embed ─────────────────────────────────────────────────────────
function BridgeRender({
  result, state, worldToScreen,
}: {
  result: RenderResult;
  state: EditorState;
  worldToScreen: (x: number, y: number) => { px: number; py: number };
}) {
  const innerHtml = useMemo(() => {
    const raw = result.svg + result.routes.map((r) => r.svg).join("");
    if (!raw) return "";
    const s = raw.indexOf("<svg");
    const e1 = raw.indexOf(">", s);
    const e2 = raw.lastIndexOf("</svg>");
    if (s !== -1 && e1 !== -1 && e2 !== -1) return raw.slice(e1 + 1, e2);
    return raw;
  }, [result]);

  const scale = state.zoom * MM_TO_PX * UM_TO_MM;
  const origin = worldToScreen(0, 0);
  return (
    <g
      transform={`translate(${origin.px} ${origin.py}) scale(${scale} ${-scale})`}
      dangerouslySetInnerHTML={{ __html: innerHtml }}
    />
  );
}

// ── PlacementPreview ─────────────────────────────────────────────────────────
interface PlacementPreviewProps {
  placement: Placement;
  pan: { x: number; y: number };
  zoom: number;
  size: { w: number; h: number };
}

const MemoPlacementPreview = memo(function PlacementPreview({
  placement, pan, zoom, size,
}: PlacementPreviewProps) {
  const previewQ = useQuery(componentPreviewQueryOptions(placement.componentId));
  const preview = previewQ.data;
  if (!preview?.svg) return null;

  const { px, py } = worldToScreenFn(placement.x, placement.y, size.w, size.h, pan, zoom);
  const scale = zoom * MM_TO_PX * (preview.units === "um" ? UM_TO_MM : 1);
  const vb = preview.viewBox;
  const svgX = px - (vb.x + vb.w / 2) * scale;
  const svgY = py - (-vb.y - vb.h / 2) * scale;

  return (
    <g>
      <svg
        x={svgX} y={svgY}
        width={vb.w * scale} height={vb.h * scale}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        overflow="visible"
        style={{ transform: `scaleY(-1)`, transformOrigin: `${px}px ${py}px` }}
        dangerouslySetInnerHTML={{ __html: preview.svg }}
      />
    </g>
  );
});

// ── ConnectionLine ────────────────────────────────────────────────────────────
interface ConnectionLineProps {
  id: string;
  routeComponentId?: string;
  startPt: { px: number; py: number };
  endPt:   { px: number; py: number };
  selected: boolean;
  onSelect: () => void;
}

const MemoConnectionLine = memo(function ConnectionLine({
  id, routeComponentId, startPt, endPt, selected, onSelect,
}: ConnectionLineProps) {
  const midX = (startPt.px + endPt.px) / 2;
  const midY = (startPt.py + endPt.py) / 2;
  return (
    <g>
      {selected && (
        <path
          d={`M ${startPt.px} ${startPt.py} L ${endPt.px} ${endPt.py}`}
          stroke="var(--primary)" strokeWidth={8} strokeOpacity={0.3} fill="none"
        />
      )}
      <path
        d={`M ${startPt.px} ${startPt.py} L ${endPt.px} ${endPt.py}`}
        stroke={selected ? "var(--primary)" : "#5B9BD5"}
        strokeWidth={selected ? 2.5 : 1.8}
        fill="none"
        className="cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      />
      <text
        x={midX} y={midY - 5}
        textAnchor="middle" fontSize={8}
        fill={selected ? "var(--primary)" : "var(--muted-foreground)"}
        className="pointer-events-none select-none"
      >
        {routeComponentId || "CPW"}
      </text>
    </g>
  );
});

// ── PlacementGlyph ────────────────────────────────────────────────────────────
interface PlacementGlyphProps {
  placement: Placement;
  pins: PinSpec[];
  selected: boolean;
  pendingPlacementId: string | null;
  pendingPin: string | null;
  pan: { x: number; y: number };
  zoom: number;
  size: { w: number; h: number };
  onStartMove: (e: React.PointerEvent, placement: Placement, el: SVGGElement) => void;
  onPinClick: (pinName: string) => void;
}

const MemoPlacementGlyph = memo(function PlacementGlyph({
  placement, pins, selected, pendingPlacementId, pendingPin,
  pan, zoom, size, onStartMove, onPinClick,
}: PlacementGlyphProps) {
  const glyphRef = useRef<SVGGElement | null>(null);
  const previewQ = useQuery(componentPreviewQueryOptions(placement.componentId));
  const vb = previewQ.data?.viewBox;
  const unitToMm = previewQ.data?.units === "um" ? 0.001 : 1;
  const sizePx = vb
    ? Math.max(vb.w, vb.h) * unitToMm * MM_TO_PX * zoom
    : Math.max(28, 0.5 * MM_TO_PX * zoom);
  const { px, py } = worldToScreenFn(placement.x, placement.y, size.w, size.h, pan, zoom);
  const half = sizePx / 2;
  const isPendingOwner = pendingPlacementId === placement.id;

  return (
    <g
      ref={glyphRef}
      data-rotation={placement.rotation}
      transform={`translate(${px} ${py}) rotate(${placement.rotation})`}
      className={cn("cursor-grab", selected && "cursor-grabbing")}
      onPointerDown={(e) => {
        if (glyphRef.current) onStartMove(e, placement, glyphRef.current);
      }}
    >
      <rect x={-half} y={-half} width={sizePx} height={sizePx} fill="transparent" stroke="none" />
      {selected && (
        <rect
          x={-half - 6} y={-half - 6}
          width={sizePx + 12} height={sizePx + 12}
          rx={6} fill="none"
          stroke="var(--primary)" strokeOpacity={0.5} strokeWidth={2} strokeDasharray="3 2"
        />
      )}
      <text
        x={0} y={half + 14}
        textAnchor="middle" fontSize={10} fontWeight={700}
        fill="var(--foreground)" className="select-none pointer-events-none"
      >
        {placement.name}
      </text>
      {pins.map((pin) => {
        const cx = pin.hint.x * MM_TO_PX * zoom;
        const cy = -pin.hint.y * MM_TO_PX * zoom;
        const isPending = isPendingOwner && pendingPin === pin.name;
        return (
          <g key={pin.name}>
            <circle
              cx={cx} cy={cy}
              r={isPending ? 5 : 3.5}
              fill={isPending ? "var(--destructive)" : selected ? "var(--primary)" : "var(--muted-foreground)"}
              stroke="var(--background)" strokeWidth={1}
              className="cursor-crosshair"
              onPointerDown={(e) => { e.stopPropagation(); onPinClick(pin.name); }}
            />
            {selected && (
              <text
                x={cx + 6} y={cy + 3}
                fontSize={8} fill="var(--foreground)" fontWeight={700}
                className="pointer-events-none select-none"
              >
                {pin.name}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

// ── PlacementGhost ────────────────────────────────────────────────────────────
function PlacementGhost({
  componentId, px, py, zoom,
}: {
  componentId: string;
  px: number; py: number;
  zoom: number;
}) {
  const previewQ = useQuery({ ...componentPreviewQueryOptions(componentId), staleTime: 0 });
  const preview = previewQ.data;

  if (!preview?.svg) {
    // Fallback ghost when no SVG available.
    const r = Math.max(12, 20 * zoom);
    return (
      <g style={{ pointerEvents: "none" }}>
        <circle cx={px} cy={py} r={r} fill="var(--primary)" fillOpacity={0.15}
          stroke="var(--primary)" strokeWidth={1.5} strokeDasharray="4 3" />
        <line x1={px - r * 0.6} y1={py} x2={px + r * 0.6} y2={py}
          stroke="var(--primary)" strokeWidth={1.5} />
        <line x1={px} y1={py - r * 0.6} x2={px} y2={py + r * 0.6}
          stroke="var(--primary)" strokeWidth={1.5} />
      </g>
    );
  }

  const scale = zoom * MM_TO_PX * (preview.units === "um" ? UM_TO_MM : 1);
  const vb = preview.viewBox;
  const svgX = px - (vb.x + vb.w / 2) * scale;
  const svgY = py - (-vb.y - vb.h / 2) * scale;

  return (
    <g style={{ pointerEvents: "none", opacity: 0.55 }}>
      {/* Semi-transparent Shapely shape */}
      <svg
        x={svgX} y={svgY}
        width={vb.w * scale} height={vb.h * scale}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        overflow="visible"
        style={{ transform: `scaleY(-1)`, transformOrigin: `${px}px ${py}px` }}
        dangerouslySetInnerHTML={{ __html: preview.svg }}
      />
      {/* Crosshair snap indicator */}
      <circle cx={px} cy={py} r={4} fill="var(--primary)" fillOpacity={0.9} />
      <line x1={px - 10} y1={py} x2={px + 10} y2={py}
        stroke="var(--primary)" strokeWidth={1} />
      <line x1={px} y1={py - 10} x2={px} y2={py + 10}
        stroke="var(--primary)" strokeWidth={1} />
    </g>
  );
}
