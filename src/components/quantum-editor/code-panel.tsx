import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, RefreshCw, Loader2 } from "lucide-react";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { bridgeClient, isBridgeConfigured } from "@/lib/bridge/client";
import { useDesignStore } from "@/lib/editor/design-store";
import type { GeneratedCode } from "@/lib/bridge/types";

export function CodePanel() {
  const { doc, state } = useDesignStore();
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);

  const mu = useMutation({
    mutationFn: () =>
      bridgeClient.generateCode(doc).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    onSuccess: (data) => {
      // Keep the cache in sync so toolbar and panel share the same result.
      queryClient.setQueryData(["bridge", "generate-code"], data);
    },
  });

  useEffect(() => {
    if (!live || !isBridgeConfigured()) return;
    const t = setTimeout(() => mu.mutate(), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rev, live]);

  // Read from cache first (set by toolbar Generate Code button), fall back to
  // the most recent mutation result. Never use a fake queryFn for cache reads.
  const cached = queryClient.getQueryData<GeneratedCode>(["bridge", "generate-code"]);
  const code = mu.data?.code ?? cached?.code ?? "";
  const filename = mu.data?.filename ?? cached?.filename ?? "design.py";

  const copy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code);
    toast.success("Code copied");
  };
  const dl = () => {
    if (!code) return;
    const blob = new Blob([code], { type: "text/x-python" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => mu.mutate()}
          disabled={!isBridgeConfigured() || mu.isPending}
          className="h-7 gap-1.5 text-[11px]"
        >
          {mu.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Regenerate
        </Button>
        <Button size="sm" variant="ghost" onClick={copy} disabled={!code} className="h-7 gap-1.5 text-[11px]">
          <Copy className="h-3 w-3" /> Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={dl} disabled={!code} className="h-7 gap-1.5 text-[11px]">
          <Download className="h-3 w-3" /> Download
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor="live-sync" className="text-[11px] text-muted-foreground">
            Live sync
          </Label>
          <Switch id="live-sync" checked={live} onCheckedChange={setLive} disabled={!isBridgeConfigured()} />
        </div>
      </div>
      <div className="flex-1 overflow-auto bg-muted/30 p-3 font-mono text-[11px] leading-relaxed">
        {!isBridgeConfigured() ? (
          <EmptyContract />
        ) : code ? (
          <pre
            className="whitespace-pre"
            dangerouslySetInnerHTML={{
              __html: Prism.highlight(code, Prism.languages.python, "python"),
            }}
          />
        ) : mu.error ? (
          <p className="text-destructive">Bridge error: {String(mu.error)}</p>
        ) : (
          <p className="text-muted-foreground">
            Click <strong>Generate Code</strong> to produce a Qiskit Metal Python script from the
            current design.
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyContract() {
  return (
    <div className="text-muted-foreground">
      <p className="mb-2">
        Bridge not configured. <code>POST /design/generate-code</code> will return:
      </p>
      <pre className="rounded border border-border bg-background p-2 text-foreground">{`{
  "language": "python",
  "filename": "design.py",
  "code": "from qiskit_metal import designs\\n..."
}`}</pre>
    </div>
  );
}
