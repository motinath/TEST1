import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
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

const MM_TO_PX = 80; // editor world unit conversion
const UM_TO_MM = 0.001;

export function EditorCanvas() {
  const { state, dispatch, doc, uniqueName } = useDesignStore();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<DragState>(null);

  // Component registry for resolving category → name prefix on drop.
  const componentsQ = useQuery(componentsQueryOptions());
  const componentsById = useMemo(() => {
    const map = new Map<string, ComponentSummary>();
    (componentsQ.data ?? []).forEach((c) => map.set(c.id, c));
    return map;
  }, [componentsQ.data]);

  // Bridge-rendered geometry for the current design.
  const renderQ = useQuery({
    queryKey: ["bridge", "render", doc],
    queryFn: ({ signal }) =>
      bridgeClient.renderDesign(doc, signal).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    enabled: isBridgeConfigured() && doc.placements.length > 0,
    staleTime: 0,
  });

  // Derive the default route component from the live bridge registry.
  // Falls back to "RouteMeander" only if no route components are discovered yet.
  const defaultRouteComponent = useMemo(() => {
    const routes = (componentsQ.data ?? []).filter((c) => c.category === "routes");
    return routes.find((c) => c.id === "RouteMeander")?.id ?? routes[0]?.id ?? "RouteMeander";
  }, [componentsQ.data]);

  // Per-placement pin queries — used to draw interactive pin handles.
  const pinQueries = useQueries({
    queries: state.placements.map((p) => componentPinsQueryOptions(p.componentId)),
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const worldToScreen = useCallback(
    (x: number, y: number) => ({
      px: size.w / 2 + (x * MM_TO_PX + state.pan.x) * state.zoom,
      py: size.h / 2 - (y * MM_TO_PX - state.pan.y) * state.zoom,
    }),
    [size, state.pan, state.zoom],
  );

  const screenToWorld = useCallback(
    (px: number, py: number) => ({
      x: (px - size.w / 2) / state.zoom / MM_TO_PX - state.pan.x / MM_TO_PX,
      y: -(py - size.h / 2) / state.zoom / MM_TO_PX + state.pan.y / MM_TO_PX,
    }),
    [size, state.pan, state.zoom],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      dispatch({ type: "ZOOM", zoom: state.zoom * factor });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [dispatch, state.zoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dispatch({ type: "CANCEL_PIN" });
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "z" &&
        !e.shiftKey
      ) {
        e.preventDefault();
        dispatch({ type: "UNDO" });
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))
      ) {
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
        else dispatch({ type: "DELETE_CONNECTION", id: state.selection.id });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, state.selection]);

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const isBg =
      target === e.currentTarget || target.getAttribute("data-canvas-bg") === "true";
    if (isBg || state.tool === "pan") {
      setDrag({
        mode: "pan",
        startX: e.clientX,
        startY: e.clientY,
        panX: state.pan.x,
        panY: state.pan.y,
      });
      dispatch({ type: "SELECT", selection: null });
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (drag.mode === "pan") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      dispatch({ type: "PAN", x: drag.panX + dx / state.zoom, y: drag.panY - dy / state.zoom });
    } else if (drag.mode === "move" && state.tool !== "pan") {
      const px = e.clientX - rect.left - drag.offsetX;
      const py = e.clientY - rect.top - drag.offsetY;
      const w = screenToWorld(px, py);
      const snap = 0.05;
      dispatch({
        type: "MOVE_PLACEMENT",
        id: drag.id,
        x: Math.round(w.x / snap) * snap,
        y: Math.round(w.y / snap) * snap,
      });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (drag && (e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    setDrag(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const componentId = e.dataTransfer.getData("application/x-silicofeller-component");
    if (!componentId) return;
    const summary = componentsById.get(componentId);
    if (!summary) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const w = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const snap = 0.05;
    const x = Math.round(w.x / snap) * snap;
    const y = Math.round(w.y / snap) * snap;
    // Fetch metadata to seed default params (cached after first call).
    const metaRes = await bridgeClient.getMetadata(componentId);
    let params: Record<string, string> = {};
    if (metaRes.data) {
      params = defaultParamsFromMetadata(metaRes.data);
    } else {
      // Req 3 AC3: show warning, proceed with empty params.
      toast.warning(`Could not load parameters for ${componentId} — placed with defaults.`);
    }
    const name = uniqueName(prefixForCategory(summary.category));
    const placement: Placement = {
      id: `pl_${name}_${Date.now()}`,
      componentId,
      name,
      x: parseFloat(x.toFixed(3)),
      y: parseFloat(y.toFixed(3)),
      rotation: 0,
      params,
    };
    dispatch({ type: "ADD_PLACEMENT", placement });
  };

  const fitView = () => {
    dispatch({ type: "ZOOM", zoom: 1 });
    dispatch({ type: "PAN", x: 0, y: 0 });
  };

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-background">
      <svg
        ref={svgRef}
        width={size.w}
        height={size.h}
        className="block touch-none select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        style={{
          backgroundImage:
            "radial-gradient(circle, color-mix(in oklab, var(--foreground) 15%, transparent) 1px, transparent 1px)",
          backgroundSize: `${24 * state.zoom}px ${24 * state.zoom}px`,
          backgroundPosition: `${state.pan.x * state.zoom + size.w / 2}px ${-state.pan.y * state.zoom + size.h / 2}px`,
          cursor:
            state.tool === "pan"
              ? drag?.mode === "pan"
                ? "grabbing"
                : "grab"
              : drag?.mode === "move"
                ? "grabbing"
                : "default",
        }}
      >
        <rect data-canvas-bg="true" x={0} y={0} width={size.w} height={size.h} fill="transparent" />

        {/* Chip boundary — visual guide, 9mm × 6mm centered at world origin. */}
        {(() => {
          const chipW = 9;
          const chipH = 6;
          const tl = worldToScreen(-chipW / 2, chipH / 2);
          const br = worldToScreen(chipW / 2, -chipH / 2);
          return (
            <rect
              x={tl.px}
              y={tl.py}
              width={br.px - tl.px}
              height={br.py - tl.py}
              fill="none"
              stroke="color-mix(in oklab, var(--foreground) 20%, transparent)"
              strokeWidth={1.5}
              strokeDasharray="8 5"
              rx={3}
            />
          );
        })()}


        {/* Layer order (bottom → top in SVG paint order):
             1. PlacementPreview  — per-component Shapely SVG
             2. BridgeRender      — full-design matplotlib SVG (overlays previews)
             3. Connection lines  — placeholder CPW lines until bridge renders routes
             4. PlacementGlyph   — hit areas, halos, pin handles (always on top)
        */}

        {/* 1. Per-placement Shapely previews (lowest layer). */}
        {state.placements.map((p) => (
          <PlacementPreview key={p.id} placement={p} worldToScreen={worldToScreen} />
        ))}

        {/* 2. Bridge-rendered full-design SVG (overlays previews when available). */}
        {renderQ.data?.svg && (
          <BridgeRender
            result={renderQ.data}
            state={state}
            worldToScreen={worldToScreen}
          />
        )}

        {/* 3. Connection lines — drawn above bridge render so they stay visible. */}
        {state.connections.map((c) => {
          const aIdx = state.placements.findIndex((x) => x.id === c.from.placementId);
          const bIdx = state.placements.findIndex((x) => x.id === c.to.placementId);
          if (aIdx === -1 || bIdx === -1) return null;
          const a = state.placements[aIdx];
          const b = state.placements[bIdx];
          const aPins = pinQueries[aIdx]?.data?.pins ?? null;
          const bPins = pinQueries[bIdx]?.data?.pins ?? null;

          const aOrigin = worldToScreen(a.x, a.y);
          const bOrigin = worldToScreen(b.x, b.y);

          let startPt: { px: number; py: number } | null = null;
          let endPt: { px: number; py: number } | null = null;

          if (aPins) {
            const pin = aPins.find((p) => p.name === c.from.pinName);
            // Pin data loaded but named pin not found — skip (Req 7 AC5)
            if (!pin) return null;
            startPt = {
              px: aOrigin.px + pin.hint.x * MM_TO_PX * state.zoom,
              py: aOrigin.py - pin.hint.y * MM_TO_PX * state.zoom,
            };
          } else {
            // Pin data not yet loaded — fall back to component center (Req 7 AC4)
            startPt = aOrigin;
          }

          if (bPins) {
            const pin = bPins.find((p) => p.name === c.to.pinName);
            if (!pin) return null;
            endPt = {
              px: bOrigin.px + pin.hint.x * MM_TO_PX * state.zoom,
              py: bOrigin.py - pin.hint.y * MM_TO_PX * state.zoom,
            };
          } else {
            endPt = bOrigin;
          }

          if (!startPt || !endPt) return null;

          const isSel = state.selection?.kind === "connection" && state.selection.id === c.id;
          const midX = (startPt.px + endPt.px) / 2;
          const midY = (startPt.py + endPt.py) / 2;
          return (
            <g key={c.id}>
              {/* Outer glow for selected state (Req 8 AC3) */}
              {isSel && (
                <path
                  d={`M ${startPt.px} ${startPt.py} L ${endPt.px} ${endPt.py}`}
                  stroke="var(--primary)"
                  strokeWidth={8}
                  strokeOpacity={0.3}
                  fill="none"
                />
              )}
              {/* Solid CPW-style line (Req 8 AC1) */}
              <path
                d={`M ${startPt.px} ${startPt.py} L ${endPt.px} ${endPt.py}`}
                stroke={isSel ? "var(--primary)" : "#5B9BD5"}
                strokeWidth={isSel ? 2.5 : 1.8}
                fill="none"
                className="cursor-pointer"
                onClick={(evt) => {
                  evt.stopPropagation();
                  dispatch({ type: "SELECT", selection: { kind: "connection", id: c.id } });
                }}
              />
              {/* Route type label at midpoint (Req 8 AC2) */}
              <text
                x={midX}
                y={midY - 5}
                textAnchor="middle"
                fontSize={8}
                fill={isSel ? "var(--primary)" : "var(--muted-foreground)"}
                className="pointer-events-none select-none"
              >
                {c.routeComponentId || "CPW"}
              </text>
            </g>
          );
        })}

        {/* 4. Placement glyphs — always on top so pin handles stay clickable. */}
        {state.placements.map((p, i) => (
          <PlacementGlyph
            key={p.id}
            placement={p}
            componentId={p.componentId}
            selected={state.selection?.kind === "placement" && state.selection.id === p.id}
            pendingPlacementId={state.pendingPin?.placementId ?? null}
            pendingPin={state.pendingPin?.pinName ?? null}
            pins={pinQueries[i]?.data?.pins ?? []}
            worldToScreen={worldToScreen}
            zoom={state.zoom}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (state.tool === "pan") return;
              dispatch({ type: "SELECT", selection: { kind: "placement", id: p.id } });
              const rect = svgRef.current?.getBoundingClientRect();
              if (!rect) return;
              const screen = worldToScreen(p.x, p.y);
              setDrag({
                mode: "move",
                id: p.id,
                offsetX: e.clientX - rect.left - screen.px,
                offsetY: e.clientY - rect.top - screen.py,
              });
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            }}
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
      </svg>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full border border-border bg-card/95 px-1 py-1 shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => dispatch({ type: "ZOOM", zoom: state.zoom / 1.2 })}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[44px] text-center text-[11px] font-bold text-foreground">
          {Math.round(state.zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => dispatch({ type: "ZOOM", zoom: state.zoom * 1.2 })}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={fitView}
          className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          title="Fit view"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {state.pendingPin && (
        <div className="absolute left-3 top-3 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary shadow-sm">
          Click another pin to connect · Esc to cancel
        </div>
      )}

      {state.placements.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-dashed border-border bg-card/70 px-6 py-4 text-center text-xs text-muted-foreground">
            {isBridgeConfigured()
              ? "Drag a component from the Library to begin."
              : "Dev preview — drag a mock component from the Library to begin."}
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

// ---------- Drag state ----------

type DragState =
  | { mode: "pan"; startX: number; startY: number; panX: number; panY: number }
  | { mode: "move"; id: string; offsetX: number; offsetY: number }
  | null;

// ---------- Bridge SVG embedding ----------

function BridgeRender({
  result,
  state,
  worldToScreen,
}: {
  result: RenderResult;
  state: EditorState;
  worldToScreen: (x: number, y: number) => { px: number; py: number };
}) {
  // The bridge render_service returns a full matplotlib SVG document.
  // Extract only the inner content (children of the root <svg>) to avoid
  // embedding a full <svg> document inside our canvas <svg> — invalid nesting.
  const innerHtml = useMemo(() => {
    const raw = result.svg + result.routes.map((r) => r.svg).join("");
    if (!raw) return "";
    // Strip the outer <svg...>...</svg> wrapper and return only the children.
    const startTag = raw.indexOf("<svg");
    const endFirstTag = raw.indexOf(">", startTag);
    const closingTag = raw.lastIndexOf("</svg>");
    if (startTag !== -1 && endFirstTag !== -1 && closingTag !== -1) {
      return raw.slice(endFirstTag + 1, closingTag);
    }
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

function PlacementPreview({
  placement,
  worldToScreen,
}: {
  placement: Placement;
  worldToScreen: (x: number, y: number) => { px: number; py: number };
}) {
  const previewQ = useQuery(componentPreviewQueryOptions(placement.componentId));
  const { state } = useDesignStore();

  const preview = previewQ.data;
  if (!preview || !preview.svg) return null;

  const { px, py } = worldToScreen(placement.x, placement.y);
  const unitToMm = preview.units === "um" ? UM_TO_MM : 1;
  const scale = state.zoom * MM_TO_PX * unitToMm;

  const vb = preview.viewBox;
  // Center the viewBox on the placement screen position.
  // The viewBox origin (vb.x, vb.y) is the top-left in SVG coords.
  // We want the center of the viewBox to land at (px, py) on screen.
  // SVG Y axis is flipped vs canvas Y axis, so we negate Y.
  const svgX = px - (vb.x + vb.w / 2) * scale;
  const svgY = py - (-vb.y - vb.h / 2) * scale;

  return (
    <g>
      <svg
        x={svgX}
        y={svgY}
        width={vb.w * scale}
        height={vb.h * scale}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        overflow="visible"
        style={{ transform: `scaleY(-1)`, transformOrigin: `${px}px ${py}px` }}
        dangerouslySetInnerHTML={{ __html: preview.svg }}
      />
    </g>
  );
}

// ---------- Placement glyph (selection halo, name, pins) ----------

function PlacementGlyph({
  placement,
  componentId,
  selected,
  pendingPlacementId,
  pendingPin,
  pins,
  worldToScreen,
  zoom,
  onPointerDown,
  onPinClick,
}: {
  placement: Placement;
  componentId: string;
  selected: boolean;
  pendingPlacementId: string | null;
  pendingPin: string | null;
  pins: PinSpec[];
  worldToScreen: (x: number, y: number) => { px: number; py: number };
  zoom: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPinClick: (pinName: string) => void;
}) {
  const previewQ = useQuery(componentPreviewQueryOptions(componentId));
  const vb = previewQ.data?.viewBox;
  const unitToMm = previewQ.data?.units === "um" ? 0.001 : 1;
  const sizePx = vb
    ? Math.max(vb.w, vb.h) * unitToMm * MM_TO_PX * zoom
    : Math.max(28, 0.5 * MM_TO_PX * zoom);
  const { px, py } = worldToScreen(placement.x, placement.y);
  const half = sizePx / 2;
  const isPendingOwner = pendingPlacementId === placement.id;

  return (
    <g
      transform={`translate(${px} ${py}) rotate(${placement.rotation})`}
      className={cn("cursor-grab", selected && "cursor-grabbing")}
      onPointerDown={onPointerDown}
    >
      {/* Invisible hit area for pointer down so the drag works even without preview. */}
      <rect
        x={-half}
        y={-half}
        width={sizePx}
        height={sizePx}
        fill="transparent"
        stroke="none"
      />
      {selected && (
        <rect
          x={-half - 6}
          y={-half - 6}
          width={sizePx + 12}
          height={sizePx + 12}
          rx={6}
          fill="none"
          stroke="var(--primary)"
          strokeOpacity={0.5}
          strokeWidth={2}
          strokeDasharray="3 2"
        />
      )}
      <text
        x={0}
        y={half + 12}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill="var(--foreground)"
        className="select-none"
      >
        {placement.name}
      </text>
      {pins.map((pin) => {
        // PinService returns coordinates already in mm — no UM_TO_MM conversion needed.
        const cx = pin.hint.x * MM_TO_PX * zoom;
        const cy = -pin.hint.y * MM_TO_PX * zoom;
        const isPending = isPendingOwner && pendingPin === pin.name;
        return (
          <g key={pin.name}>
            <circle
              cx={cx}
              cy={cy}
              r={isPending ? 5 : 3.5}
              fill={
                isPending
                  ? "var(--destructive)"
                  : selected
                    ? "var(--primary)"
                    : "var(--muted-foreground)"
              }
              stroke="var(--background)"
              strokeWidth={1}
              className="cursor-crosshair"
              onPointerDown={(e) => {
                e.stopPropagation();
                onPinClick(pin.name);
              }}
            />
            {selected && (
              <text
                x={cx + 6}
                y={cy + 3}
                fontSize={8}
                fill="var(--foreground)"
                fontWeight={700}
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
}
