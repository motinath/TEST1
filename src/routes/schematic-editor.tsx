import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Toaster } from "@/components/ui/sonner";
import { DesignStoreProvider } from "@/lib/editor/design-store";
import { ComponentLibrary } from "@/components/quantum-editor/component-library";
import { PropertyInspector } from "@/components/quantum-editor/property-inspector";
import { EditorCanvas } from "@/components/quantum-editor/editor-canvas";
import { EditorToolbar } from "@/components/quantum-editor/editor-toolbar";
import { BottomPanel } from "@/components/quantum-editor/bottom-panel";
import { isBridgeConfigured } from "@/lib/bridge/client";

export const Route = createFileRoute("/schematic-editor")({
  head: () => ({
    meta: [
      { title: "Schematic Editor — Silicofeller" },
      {
        name: "description",
        content:
          "Visual schematic editor for superconducting quantum chip design — a pure UI layer over Qiskit Metal.",
      },
      { property: "og:title", content: "Schematic Editor — Silicofeller" },
      {
        property: "og:description",
        content: "Drag, place, and connect Qiskit Metal components in the browser.",
      },
    ],
  }),
  component: SchematicEditorRoute,
  errorComponent: ErrorBoundary,
  notFoundComponent: () => <div className="p-8">Editor not found.</div>,
});

function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-lg border border-border bg-card p-6">
        <h2 className="mb-2 text-lg font-bold text-foreground">Editor failed to load</h2>
        <p className="mb-4 text-sm text-muted-foreground">{error.message}</p>
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

function SchematicEditorRoute() {
  return (
    <DesignStoreProvider>
      <SchematicEditorShell />
      <Toaster position="top-right" />
    </DesignStoreProvider>
  );
}

function SchematicEditorShell() {
  const [bottomTab, setBottomTab] = useState("console");

  return (
    <div className="flex h-screen flex-col bg-background">
      <EditorToolbar
        onShowCode={() => setBottomTab("code")}
        onShowValidation={() => setBottomTab("validation")}
      />
      {!isBridgeConfigured() && (
        <div className="flex items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Development preview</strong> — Qiskit Metal bridge not configured. Using mock
            components. Set <code className="rounded bg-amber-500/20 px-1 py-0.5">VITE_BRIDGE_URL</code>{" "}
            to switch to live bridge data automatically.
          </span>
        </div>
      )}
      <div className="border-b border-border bg-muted/30 px-3 py-1 text-[10px]">
        <Link to="/" className="text-muted-foreground hover:text-foreground">
          ← Home
        </Link>
      </div>
      <ResizablePanelGroup orientation="vertical" className="flex-1">
        <ResizablePanel defaultSize="70%" minSize="30%">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize="20%" minSize="14%" maxSize="32%">
              <div className="h-full overflow-hidden border-r border-border bg-card p-2">
                <ComponentLibrary />
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="56%" minSize="30%">
              <EditorCanvas />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="24%" minSize="16%" maxSize="36%">
              <div className="h-full overflow-y-auto border-l border-border bg-card p-3">
                <PropertyInspector />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="30%" minSize="12%">
          <BottomPanel activeTab={bottomTab} onTabChange={setBottomTab} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
