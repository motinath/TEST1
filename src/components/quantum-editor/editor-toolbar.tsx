import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Undo2,
  Redo2,
  MousePointer2,
  Hand,
  Code2,
  ShieldCheck,
  RefreshCw,
  Loader2,
  FilePlus,
  Save,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDesignStore, type Tool, clearDesign } from "@/lib/editor/design-store";
import { bridgeClient } from "@/lib/bridge/client";
import { IBM5QubitPreset } from "@/lib/presets/ibm5qubit";
import { saveDesign } from "@/lib/editor/persistence";
import type { DesignDocument } from "@/lib/bridge/types";


interface Props {
  onShowCode: () => void;
  onShowValidation: () => void;
}

export function EditorToolbar({ onShowCode, onShowValidation }: Props) {
  const { state, dispatch, doc, canUndo, canRedo } = useDesignStore();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"render" | "validate" | "code" | null>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);

  // ---------- Save to file (Req 13 AC1-2) ----------
  const handleSave = () => {
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "design.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------- Load from file (Req 13 AC3-5) ----------
  const handleLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after a failure.
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as unknown;
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          !Array.isArray((parsed as DesignDocument).placements) ||
          !Array.isArray((parsed as DesignDocument).connections)
        ) {
          toast.error("Invalid design file — missing placements or connections arrays.");
          return;
        }
        const loaded = parsed as DesignDocument;
        dispatch({ type: "LOAD", doc: loaded });
        saveDesign(loaded);
        toast.success(`Loaded ${loaded.placements.length} placements, ${loaded.connections.length} connections.`);
      } catch {
        toast.error("Could not parse file — invalid JSON.");
      }
    };
    reader.readAsText(file);
  };

  const renderMu = useMutation({
    mutationFn: () =>
      bridgeClient.renderDesign(doc).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    onMutate: () => setBusy("render"),
    onSettled: () => setBusy(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bridge", "render"] });
      toast.success("Design rendered");
    },
    onError: (e) => toast.error(`Render failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const validateMu = useMutation({
    mutationFn: () =>
      bridgeClient.validateDesign(doc).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    onMutate: () => setBusy("validate"),
    onSettled: () => setBusy(null),
    onSuccess: (data) => {
      onShowValidation();
      if (data.valid) toast.success(`Validation passed (${data.issues.length} notes)`);
      else
        toast.error(
          `Validation failed: ${data.issues.filter((i) => i.severity === "error").length} error(s)`,
        );
    },
    onError: (e) =>
      toast.error(`Validation failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const codeMu = useMutation({
    mutationFn: () =>
      bridgeClient.generateCode(doc).then((r) => {
        if (r.error) throw new Error(r.error);
        return r.data!;
      }),
    onMutate: () => setBusy("code"),
    onSettled: () => setBusy(null),
    onSuccess: (data) => {
      queryClient.setQueryData(["bridge", "generate-code"], data);
      onShowCode();
      toast.success("Code generated");
    },
    onError: (e) =>
      toast.error(`Generate failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const setTool = (t: Tool) => dispatch({ type: "SET_TOOL", tool: t });

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-11 items-center gap-2 border-b border-border bg-card px-3">
        <div className="flex items-center gap-1">
          <span className="text-sm font-bold text-foreground">Silicofeller</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            Schematic
          </span>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearDesign();
                dispatch({ type: "LOAD", doc: { placements: [], connections: [] } });
              }}
              className="h-8 gap-1.5 text-[11px] text-muted-foreground"
            >
              <FilePlus className="h-3.5 w-3.5" />
              New
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear canvas and start a new design</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSave}
              disabled={doc.placements.length === 0}
              className="h-8 gap-1.5 text-[11px] text-muted-foreground"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export design as design.json</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadInputRef.current?.click()}
              className="h-8 gap-1.5 text-[11px] text-muted-foreground"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Load
            </Button>
          </TooltipTrigger>
          <TooltipContent>Load design from a JSON file</TooltipContent>
        </Tooltip>
        {/* Hidden file input for load */}
        <input
          ref={loadInputRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={handleLoadFile}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                dispatch({ type: "LOAD", doc: IBM5QubitPreset });
                saveDesign(IBM5QubitPreset);
                dispatch({ type: "ZOOM", zoom: 0.9 });
                dispatch({ type: "PAN", x: 0, y: 0 });
              }}
              className="h-8 gap-1.5 border-blue-200 bg-blue-50 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
            >
              ⬡ IBM 5Q
            </Button>
          </TooltipTrigger>
          <TooltipContent>Load IBM 5-qubit chip (ibmq_5_yorktown topology)</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-6" />


        <ToolButton
          icon={MousePointer2}
          label="Select"
          active={state.tool === "select"}
          onClick={() => setTool("select")}
        />
        <ToolButton
          icon={Hand}
          label="Pan"
          active={state.tool === "pan"}
          onClick={() => setTool("pan")}
        />

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolButton
          icon={Undo2}
          label="Undo (⌘Z)"
          onClick={() => dispatch({ type: "UNDO" })}
          disabled={!canUndo}
        />
        <ToolButton
          icon={Redo2}
          label="Redo (⌘⇧Z)"
          onClick={() => dispatch({ type: "REDO" })}
          disabled={!canRedo}
        />

        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "render" || doc.placements.length === 0}
                onClick={() => renderMu.mutate()}
                className="h-8 gap-1.5 text-[11px]"
              >
                {busy === "render" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Render
              </Button>
            </TooltipTrigger>
            <TooltipContent>POST /design/render</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={busy === "validate" || doc.placements.length === 0}
                onClick={() => validateMu.mutate()}
                className="h-8 gap-1.5 text-[11px]"
              >
                {busy === "validate" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                Validate
              </Button>
            </TooltipTrigger>
            <TooltipContent>POST /design/validate</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                disabled={busy === "code" || doc.placements.length === 0}
                onClick={() => codeMu.mutate()}
                className="h-8 gap-1.5 text-[11px]"
              >
                {busy === "code" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Code2 className="h-3.5 w-3.5" />
                )}
                Generate Code
              </Button>
            </TooltipTrigger>
            <TooltipContent>POST /design/generate-code</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
}

function ToolButton({
  icon: Icon,
  label,
  active,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "h-8 w-8 rounded-md",
            active && "bg-primary/10 text-primary hover:bg-primary/15",
          )}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
