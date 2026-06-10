import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Loader2, RefreshCw, MinusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bridgeClient, isBridgeConfigured, bridgeUrl } from "@/lib/bridge/client";

type Status = "idle" | "running" | "pass" | "fail" | "skipped";

interface Check {
  id: string;
  label: string;
  run: () => Promise<{ ok: boolean; detail?: string }>;
}

const FIXTURES = ["TransmonPocket", "TransmonCross", "LaunchpadWirebond", "RouteMeander"];

function buildChecks(): Check[] {
  return [
    {
      id: "list",
      label: "GET /components → contains all 4 fixtures",
      run: async () => {
        const r = await bridgeClient.listComponents();
        if (r.error) return { ok: false, detail: r.error };
        const ids = new Set(r.data!.map((c) => c.id));
        const missing = FIXTURES.filter((f) => !ids.has(f));
        return missing.length === 0
          ? { ok: true, detail: `${r.data!.length} components` }
          : { ok: false, detail: `missing: ${missing.join(", ")}` };
      },
    },
    ...FIXTURES.flatMap<Check>((id) => [
      {
        id: `${id}-meta`,
        label: `GET /components/${id}/metadata`,
        run: async () => {
          const r = await bridgeClient.getMetadata(id);
          if (r.error) return { ok: false, detail: r.error };
          return r.data!.parameters.length > 0
            ? { ok: true, detail: `${r.data!.parameters.length} params` }
            : { ok: false, detail: "no parameters returned" };
        },
      },
      {
        id: `${id}-pins`,
        label: `GET /components/${id}/pins`,
        run: async () => {
          const r = await bridgeClient.getPins(id);
          if (r.error) return { ok: false, detail: r.error };
          return { ok: true, detail: `${r.data!.pins.length} pins` };
        },
      },
      {
        id: `${id}-preview`,
        label: `GET /components/${id}/preview`,
        run: async () => {
          const r = await bridgeClient.getPreview(id);
          if (r.error) return { ok: false, detail: r.error };
          const svgLen = r.data!.svg.length;
          const trimmedSvg = r.data!.svg.trim();
          const looksLikeDoc =
            trimmedSvg.startsWith("<?xml") || trimmedSvg.startsWith("<svg");
          return svgLen > 0
            ? {
                ok: !looksLikeDoc,
                detail: looksLikeDoc
                  ? `${svgLen} chars (full SVG doc - bridge should return fragment only)`
                  : `${svgLen} chars (fragment)`,
              }
            : { ok: false, detail: "empty SVG" };
        },
      },
    ]),
  ];
}

export function BridgeStatus() {
  const queryClient = useQueryClient();
  const [results, setResults] = useState<Record<string, { status: Status; detail?: string }>>({});
  const [running, setRunning] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("silicofeller:registry:lastSeen");
  });
  const checks = buildChecks();

  const runAll = async () => {
    setRunning(true);
    setResults({});
    const local: Record<string, { status: Status; detail?: string }> = {};
    for (const c of checks) {
      setResults((prev) => ({ ...prev, [c.id]: { status: "running" } }));
      try {
        const r = await c.run();
        local[c.id] = { status: r.ok ? "pass" : "fail", detail: r.detail };
        setResults((prev) => ({
          ...prev,
          [c.id]: local[c.id],
        }));
      } catch (e) {
        local[c.id] = { status: "fail", detail: e instanceof Error ? e.message : String(e) };
        setResults((prev) => ({
          ...prev,
          [c.id]: local[c.id],
        }));
      }
    }
    setRunning(false);
    const allPass = Object.values(local).every((r) => r.status === "pass");
    if (allPass) {
      const now = new Date().toLocaleString();
      localStorage.setItem("silicofeller:registry:lastSeen", now);
      setLastSeen(now);
    }
  };


  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-1 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            Bridge URL:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-foreground">
              {bridgeUrl() || "(unset)"}
            </code>
          </span>
          <div className="ml-auto flex items-center gap-1">

          <Button
            size="sm"
            variant="outline"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["bridge"] })}
            className="h-7 gap-1.5 text-[11px]"
          >
            <RefreshCw className="h-3 w-3" /> Invalidate cache
          </Button>
            <Button
              size="sm"
              disabled={!isBridgeConfigured() || running}
              onClick={runAll}
              className="h-7 gap-1.5 text-[11px]"
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Run Phase 0
            </Button>
          </div>
        </div>
        {lastSeen && (
          <span className="text-[10px] text-muted-foreground">
            Registry validated: {lastSeen}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3 text-[11px]">
        {!isBridgeConfigured() && (
          <p className="text-muted-foreground">
            Configure <code className="rounded bg-muted px-1 py-0.5">VITE_BRIDGE_URL</code> to run
            Phase 0 validation against the Qiskit Metal bridge.
          </p>
        )}
        <ul className="space-y-1">
          {checks.map((c) => {
            const r = results[c.id];
            const status: Status = r?.status ?? "idle";
            return (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded border border-border bg-card px-2 py-1"
              >
                <StatusIcon status={status} />
                <span className="flex-1 font-mono text-foreground">{c.label}</span>
                {r?.detail && (
                  <span
                    className={
                      status === "fail" ? "text-destructive" : "text-muted-foreground"
                    }
                  >
                    {r.detail}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: Status }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "pass") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "fail") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === "skipped") return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground" />;
  return <MinusCircle className="h-3.5 w-3.5 text-muted-foreground/40" />;
}
