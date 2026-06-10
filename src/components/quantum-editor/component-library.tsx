import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight, Search, Box, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { componentsQueryOptions, componentPreviewQueryOptions } from "@/lib/bridge/queries";

import type { ComponentCategory, ComponentSummary } from "@/lib/bridge/types";
import { isBridgeConfigured } from "@/lib/bridge/client";

const CATEGORY_ORDER: ComponentCategory[] = [
  "qubits",
  "resonators",
  "couplers",
  "routes",
  "launchpads",
  "ground",
  "terminations",
  "other",
];

export function ComponentLibrary() {
  return <LibraryContent />;
}

function LibraryContent() {
  const [filter, setFilter] = useState("");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState<Partial<Record<ComponentCategory, boolean>>>({
    qubits: true,
    routes: true,
  });

  // Suppress SSR/client mismatch by only showing dynamic content after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  const { data = [], isLoading, isError } = useQuery({
    ...componentsQueryOptions(),
    // Don't run on server — avoids hydration mismatch from async bridge data
    enabled: mounted,
  });

  const grouped: Record<ComponentCategory, ComponentSummary[]> = {
    qubits: [],
    resonators: [],
    couplers: [],
    routes: [],
    launchpads: [],
    ground: [],
    terminations: [],
    other: [],
  };
  const q = filter.trim().toLowerCase();
  for (const c of data) {
    if (q && !c.name.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) continue;
    (grouped[c.category] ?? grouped.other).push(c);
  }

  const bridgeLabel = isBridgeConfigured() ? "From bridge" : "Dev preview (mock)";

  return (
    <div className="flex h-full flex-col gap-2 text-xs">
      <div className="px-1 pb-1">
        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          Component Library
        </p>
        {/* Only render the count client-side to avoid SSR mismatch */}
        <p className="text-[10px] text-muted-foreground/80">
          {bridgeLabel}
          {mounted && data.length > 0 && ` · ${data.length} components`}
        </p>
      </div>
      <div className="relative px-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter components"
          className="h-7 pl-7 text-[11px]"
        />
      </div>

      {(!mounted || isLoading) && (
        <div className="flex flex-1 items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading components…
        </div>
      )}

      {mounted && isError && (
        <div className="px-2 py-2 text-[11px] text-destructive">
          Failed to load components. Is the bridge running?
        </div>
      )}

      {mounted && !isLoading && !isError && (
        <div className="flex-1 space-y-1 overflow-y-auto px-1 pb-2">
          {CATEGORY_ORDER.map((cat) => {
            const items = grouped[cat];
            if (items.length === 0) return null;
            const isOpen = open[cat] ?? false;
            return (
              <div key={cat} className="overflow-hidden rounded-md border border-border bg-card">
                <button
                  type="button"
                  onClick={() => setOpen((s) => ({ ...s, [cat]: !isOpen }))}
                  className="flex w-full items-center justify-between border-b border-border bg-muted/40 px-2 py-1.5 text-left text-[11px] font-semibold text-foreground hover:bg-muted"
                >
                  <span className="capitalize">{cat}</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {items.length}
                    {isOpen ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                  </span>
                </button>
                {isOpen && (
                  <div className="grid grid-cols-2 gap-1.5 p-1.5">
                    {items.map((c) => (
                      <LibraryItem key={c.id} component={c} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LibraryItem({ component }: { component: ComponentSummary }) {
  const [dragging, setDragging] = useState(false);
  const previewQ = useQuery(componentPreviewQueryOptions(component.id));

  return (
    <motion.div
      draggable
      animate={{ scale: dragging ? 0.95 : 1, opacity: dragging ? 0.6 : 1 }}
      transition={{ duration: 0.12 }}
      onDragStart={(e) => {
        const dt = (e as unknown as DragEvent).dataTransfer;
        if (dt) {
          dt.setData("application/x-silicofeller-component", component.id);
          dt.effectAllowed = "copy";
        }
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "group flex cursor-grab flex-col items-center gap-1 rounded-md border border-border bg-background p-1.5 transition-all hover:border-primary hover:shadow-sm active:cursor-grabbing",
      )}
      title={`${component.name} — ${component.description ?? component.category}`}
    >
      {/* Preview thumbnail */}
      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded bg-muted/40">
        {previewQ.data?.svg ? (
          <svg
            viewBox={`${previewQ.data.viewBox.x} ${previewQ.data.viewBox.y} ${previewQ.data.viewBox.w} ${previewQ.data.viewBox.h}`}
            className="h-full w-full"
            color="currentColor"
            dangerouslySetInnerHTML={{ __html: previewQ.data.svg }}
          />
        ) : previewQ.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <Box className="h-5 w-5 text-muted-foreground group-hover:text-primary" />
        )}
      </div>

      {/* Name — truncated with full name on hover via title */}
      <span
        className="w-full truncate text-center text-[10px] font-semibold leading-tight text-foreground"
        title={component.name}
      >
        {component.name}
      </span>
    </motion.div>
  );
}
