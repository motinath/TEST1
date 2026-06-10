import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Cpu } from "lucide-react";
import { useBridgeStatus } from "@/hooks/use-bridge-status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Silicofeller — Visual editor for Qiskit Metal" },
      {
        name: "description",
        content:
          "Browser-based schematic editor for superconducting quantum chip design, built as a pure UI layer over Qiskit Metal.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const bridge = useBridgeStatus();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Cpu className="h-6 w-6 text-primary" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Silicofeller</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          A pure UI layer over Qiskit Metal. Drag, place, connect, and tune quantum chip
          components — Qiskit Metal owns geometry, parameters, and generated Python.
        </p>
        <Link
          to="/schematic-editor"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Open Schematic Editor
          <ArrowRight className="h-4 w-4" />
        </Link>
        <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "inline-block h-2 w-2 rounded-full",
              bridge.state === "online" && "bg-emerald-500",
              bridge.state === "offline" && "bg-destructive",
              bridge.state === "mock" && "bg-amber-500",
            )}
          />
          {bridge.state === "online" && `Bridge connected · ${bridge.count} components`}
          {bridge.state === "offline" && "Bridge offline — check VITE_BRIDGE_URL"}
          {bridge.state === "mock" && "Development preview — using mock components"}
        </div>
      </div>
    </div>
  );
}
