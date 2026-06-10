import { queryOptions } from "@tanstack/react-query";
import { bridgeClient } from "./client";
import type { BridgeResult } from "./types";

const DAY = 1000 * 60 * 60 * 24;
const WEEK = DAY * 7;

function unwrap<T>(r: BridgeResult<T>): T {
  if (r.error) throw new Error(r.error);
  return r.data as T;
}

export const componentsQueryOptions = () =>
  queryOptions({
    queryKey: ["bridge", "components"] as const,
    queryFn: async ({ signal }) => unwrap(await bridgeClient.listComponents(signal)),
    staleTime: DAY,
    gcTime: WEEK,
  });

export const componentMetadataQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["bridge", "components", id, "metadata"] as const,
    queryFn: async ({ signal }) => unwrap(await bridgeClient.getMetadata(id, signal)),
    staleTime: DAY,
    gcTime: WEEK,
    enabled: id.length > 0,
  });

export const componentPinsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["bridge", "components", id, "pins"] as const,
    queryFn: async ({ signal }) => unwrap(await bridgeClient.getPins(id, signal)),
    staleTime: DAY,
    gcTime: WEEK,
    enabled: id.length > 0,
  });

export const componentPreviewQueryOptions = (
  id: string,
  params?: Record<string, string | number>,
) =>
  queryOptions({
    queryKey: ["bridge", "components", id, "preview", params ?? null] as const,
    queryFn: async ({ signal }) => {
      const result = await bridgeClient.getPreview(id, params, signal);
      const data = unwrap(result);
      // If the bridge returned an empty SVG, don't cache it — routes and
      // abstract base classes have no standalone geometry. Return the data
      // but with staleTime:0 so the next mount retries rather than serving
      // a permanently-cached blank.
      return data;
    },
    // Only cache non-empty previews for a full day. Empty previews (routes etc.)
    // use staleTime:0 so they never serve stale blanks.
    staleTime: params ? 0 : DAY,
    gcTime: WEEK,
    enabled: id.length > 0,
    // Treat an empty svg as a soft failure — don't retry aggressively.
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes("empty")) return false;
      return failureCount < 1;
    },
  });
