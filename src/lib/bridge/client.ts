import type {
  BridgeResult,
  ComponentMetadata,
  ComponentPins,
  ComponentPreview,
  ComponentSummary,
  DesignDocument,
  GeneratedCode,
  RenderResult,
  ValidationResult,
} from "./types";
import { mockBridge } from "./mock";

const RAW_URL = (import.meta.env.VITE_BRIDGE_URL as string | undefined) ?? "";
const BASE_URL = RAW_URL.replace(/\/$/, "");

export function isBridgeConfigured(): boolean {
  return BASE_URL.length > 0;
}

/**
 * The editor is always "available": when no bridge is configured we serve
 * a small set of mock fixtures so the UI is exercisable in development.
 */
export function isBridgeAvailable(): boolean {
  return true;
}

export type BridgeMode = "live" | "mock";

export function bridgeMode(): BridgeMode {
  return isBridgeConfigured() ? "live" : "mock";
}

export function bridgeUrl(): string {
  return BASE_URL;
}

function ok<T>(data: T): BridgeResult<T> {
  return { data, error: null };
}

function notFound<T>(what: string): BridgeResult<T> {
  return { data: null, error: `${what} not available in development preview.` };
}

async function call<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<BridgeResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error?.message) detail = body.error.message;
      } catch {
        // ignore non-JSON error bodies
      }
      return { data: null, error: detail };
    }
    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export const bridgeClient = {
  listComponents: async (signal?: AbortSignal) => {
    if (!isBridgeConfigured()) return ok(mockBridge.listComponents());
    return call<ComponentSummary[]>("/components", { method: "GET", signal });
  },

  getComponent: async (id: string, signal?: AbortSignal) => {
    if (!isBridgeConfigured()) {
      const c = mockBridge.getComponent(id);
      return c ? ok(c) : notFound<ComponentSummary>(`Component "${id}"`);
    }
    return call<ComponentSummary>(`/components/${encodeURIComponent(id)}`, {
      method: "GET",
      signal,
    });
  },

  getMetadata: async (id: string, signal?: AbortSignal) => {
    if (!isBridgeConfigured()) {
      const m = mockBridge.getMetadata(id);
      return m ? ok(m) : notFound<ComponentMetadata>(`Metadata for "${id}"`);
    }
    return call<ComponentMetadata>(`/components/${encodeURIComponent(id)}/metadata`, {
      method: "GET",
      signal,
    });
  },

  getPins: async (id: string, signal?: AbortSignal) => {
    if (!isBridgeConfigured()) {
      const p = mockBridge.getPins(id);
      return p ? ok(p) : notFound<ComponentPins>(`Pins for "${id}"`);
    }
    return call<ComponentPins>(`/components/${encodeURIComponent(id)}/pins`, {
      method: "GET",
      signal,
    });
  },

  getPreview: async (
    id: string,
    params?: Record<string, string | number>,
    signal?: AbortSignal,
  ) => {
    if (!isBridgeConfigured()) {
      const p = mockBridge.getPreview(id);
      return p ? ok(p) : notFound<ComponentPreview>(`Preview for "${id}"`);
    }
    const qs = params ? `?params=${encodeURIComponent(JSON.stringify(params))}` : "";
    return call<ComponentPreview>(`/components/${encodeURIComponent(id)}/preview${qs}`, {
      method: "GET",
      signal,
    });
  },

  validateDesign: async (doc: DesignDocument, signal?: AbortSignal) => {
    if (!isBridgeConfigured()) return ok(mockBridge.validateDesign(doc));
    return call<ValidationResult>("/design/validate", {
      method: "POST",
      body: JSON.stringify(doc),
      signal,
    });
  },

  generateCode: async (doc: DesignDocument, signal?: AbortSignal) => {
    if (!isBridgeConfigured()) return ok(mockBridge.generateCode(doc));
    return call<GeneratedCode>("/design/generate-code", {
      method: "POST",
      body: JSON.stringify(doc),
      signal,
    });
  },

  renderDesign: async (doc: DesignDocument, signal?: AbortSignal) => {
    if (!isBridgeConfigured()) return ok(mockBridge.renderDesign(doc));
    return call<RenderResult>("/design/render", {
      method: "POST",
      body: JSON.stringify(doc),
      signal,
    });
  },
};
