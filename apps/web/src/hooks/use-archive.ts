"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteBackendStory, loadArchive, updateBackendStory, type ArchiveAuthMode } from "@/lib/archive/archive-client";
import {
  loadLocalArchive,
  persistLocalArchive,
  removeStory,
  updateStory,
} from "@/lib/archive/local-repository";
import { getSeedArchive } from "@/lib/archive/seed";
import type { ArchiveSnapshot, Story } from "@/lib/archive/types";

type PendingMutation = { kind: "update"; story: Story } | { kind: "delete"; storyId: string };
const PENDING_MUTATION_KEY = "linger.archive.pending-mutation.v1";

function loadPendingMutation(): PendingMutation | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(PENDING_MUTATION_KEY) ?? "null") as Partial<PendingMutation> | null;
    if (value?.kind === "delete" && typeof value.storyId === "string") return { kind: "delete", storyId: value.storyId };
    if (value?.kind === "update" && value.story && typeof value.story === "object" && typeof (value.story as Story).id === "string") {
      return { kind: "update", story: value.story as Story };
    }
  } catch {
    window.localStorage.removeItem(PENDING_MUTATION_KEY);
  }
  return null;
}

export function useArchive(options: { preferBackend?: boolean } = {}) {
  const [archive, setArchive] = useState<ArchiveSnapshot>(() => getSeedArchive());
  const [loading, setLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);
  const [source, setSource] = useState<"backend" | "local">("local");
  const [authMode, setAuthMode] = useState<ArchiveAuthMode>(options.preferBackend ? null : "mock");
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(loadPendingMutation);
  const initialLoadStarted = useRef(false);

  const rememberPending = useCallback((mutation: PendingMutation | null) => {
    setPendingMutation(mutation);
    if (mutation) window.localStorage.setItem(PENDING_MUTATION_KEY, JSON.stringify(mutation));
    else window.localStorage.removeItem(PENDING_MUTATION_KEY);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    if (pendingMutation) {
      try {
        const synced = pendingMutation.kind === "update"
          ? await updateBackendStory(pendingMutation.story)
          : await deleteBackendStory(pendingMutation.storyId);
        rememberPending(null);
        setArchive(synced);
        setSource("backend");
        setWarning(null);
      } catch {
        setWarning("The pending change still has not synced. It remains on this device; retry without refreshing over it.");
      } finally {
        setLoading(false);
      }
      return;
    }
    const result = await loadArchive({ preferBackend: options.preferBackend === true });
    setArchive(result.value);
    setSource(result.source);
    setAuthMode(result.authMode ?? null);
    setWarning(result.warning);
    setLoading(false);
  }, [options.preferBackend, pendingMutation, rememberPending]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!initialLoadStarted.current) {
        initialLoadStarted.current = true;
        void refresh();
      }
    }, 0);
    const onArchive = (event: Event) => {
      const snapshot = (event as CustomEvent<ArchiveSnapshot>).detail;
      setArchive(snapshot ?? loadLocalArchive());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith("linger.demo.archive")) setArchive(loadLocalArchive());
    };
    window.addEventListener("linger:archive-updated", onArchive);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("linger:archive-updated", onArchive);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  const saveStory = useCallback(async (story: Story) => {
    if (source === "backend") {
      try {
        const synced = await updateBackendStory(story);
        setArchive(synced);
        setWarning(null);
        return;
      } catch {
        // Preserve the reviewed edit locally so it can be exported or retried.
        rememberPending({ kind: "update", story });
      }
    }
    const updated = updateStory(loadLocalArchive(), story);
    persistLocalArchive(updated);
    setArchive(updated);
    setSource("local");
    setAuthMode("mock");
    setWarning("This edit is saved on this device but has not synced. Retry when the family archive reconnects.");
  }, [rememberPending, source]);

  const deleteStory = useCallback(async (storyId: string) => {
    if (source === "backend") {
      try {
        const synced = await deleteBackendStory(storyId);
        setArchive(synced);
        setWarning(null);
        return;
      } catch {
        // Continue with a visible, reversible-on-server local fallback.
        rememberPending({ kind: "delete", storyId });
      }
    }
    const updated = removeStory(loadLocalArchive(), storyId);
    persistLocalArchive(updated);
    setArchive(updated);
    setSource("local");
    setAuthMode("mock");
    setWarning("Removed on this device only. The server copy remains until you retry while connected.");
  }, [rememberPending, source]);

  return { archive, setArchive, loading, warning, source, authMode, pendingMutation, refresh, saveStory, deleteStory };
}
