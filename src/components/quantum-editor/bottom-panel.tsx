import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Terminal,
  ShieldCheck,
  Code2,
  Activity,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { bridgeClient, isBridgeConfigured } from "@/lib/bridge/client";
import { useDesignStore } from "@/lib/editor/design-store";
import { CodePanel } from "./code-panel";
import { BridgeStatus } from "./bridge-status";
import type { ValidationResult } from "@/lib/bridge/types";

export function BottomPanel({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (t: string) => void;
}) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={onTabChange}
      className="flex h-full flex-col bg-card text-foreground"
    >
      <div className="flex h-9 items-center border-b border-border bg-muted/40 px-2">
        <TabsList className="h-full gap-1 rounded-none bg-transparent p-0">
          <TabTrigger value="console" icon={Terminal} label="Console" />
          <TabTrigger value="validation" icon={ShieldCheck} label="Validation" />
          <TabTrigger value="code" icon={Code2} label="Generated Code" />
          <TabTrigger value="bridge" icon={Activity} label="Bridge Status" />
        </TabsList>
      </div>
      <TabsContent value="console" className="flex-1 overflow-auto p-3 text-[11px]">
        <ConsoleTab />
      </TabsContent>
      <TabsContent value="validation" className="flex-1 overflow-auto">
        <ValidationTab />
      </TabsContent>
      <TabsContent value="code" className="flex-1 overflow-hidden">
        <CodePanel />
      </TabsContent>
      <TabsContent value="bridge" className="flex-1 overflow-hidden">
        <BridgeStatus />
      </TabsContent>
    </Tabs>
  );
}

function TabTrigger({
  value,
  icon: Icon,
  label,
}: {
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className="h-full gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 text-[11px] font-semibold text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-background data-[state=active]:text-foreground"
    >
      <Icon className="h-3 w-3" />
      {label}
    </TabsTrigger>
  );
}

function ConsoleTab() {
  const { state } = useDesignStore();
  const lines = useMemo(() => {
    const out: { t: string; kind: "info" | "ok"; text: string }[] = [];
    state.placements.forEach((p) =>
      out.push({ t: "·", kind: "ok", text: `Placed ${p.name} (${p.componentId}) @ (${p.x}, ${p.y}) mm` }),
    );
    state.connections.forEach((c) =>
      out.push({
        t: "·",
        kind: "info",
        text: `Connection ${c.from.placementId}.${c.from.pinName} → ${c.to.placementId}.${c.to.pinName}${c.routeComponentId ? ` via ${c.routeComponentId}` : ""}`,
      }),
    );
    return out;
  }, [state.placements, state.connections]);
  return (
    <div className="font-mono text-foreground">
      {lines.length === 0 ? (
        <p className="text-muted-foreground">No activity yet.</p>
      ) : (
        lines.map((l, i) => (
          <div key={i} className={l.kind === "ok" ? "text-emerald-500" : "text-foreground"}>
            <span className="mr-2 text-muted-foreground">{l.t}</span>
            {l.text}
          </div>
        ))
      )}
    </div>
  );
}

function ValidationTab() {
  const { doc } = useDesignStore();
  const [result, setResult] = useState<ValidationResult | null>(null);
  const mu = useMutation({
    mutationFn: () =>
      bridgeClient.validateDesign(doc).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    onSuccess: setResult,
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Button
          size="sm"
          disabled={mu.isPending}
          onClick={() => mu.mutate()}
          className="h-7 gap-1.5 text-[11px]"
        >
          {mu.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Run validation
        </Button>
        {result && (
          <span
            className={`flex items-center gap-1 text-[11px] ${result.valid ? "text-emerald-500" : "text-destructive"}`}
          >
            {result.valid ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {result.valid ? "Passed" : "Failed"} · {result.issues.length} issue
            {result.issues.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3 text-[11px]">
        {!result && !mu.isPending && (
          <p className="text-muted-foreground">Run validation to see DRC issues from the bridge.</p>
        )}
        {result?.issues.map((i, idx) => (
          <div
            key={idx}
            className="mb-1 flex items-start gap-2 rounded border border-border bg-card p-2"
          >
            <span
              className={`mt-0.5 inline-block rounded px-1 text-[9px] font-bold uppercase ${
                i.severity === "error"
                  ? "bg-destructive/10 text-destructive"
                  : i.severity === "warning"
                    ? "bg-amber-500/10 text-amber-600"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i.severity}
            </span>
            <div>
              <div className="font-mono text-foreground">{i.rule}</div>
              <div className="text-muted-foreground">{i.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
