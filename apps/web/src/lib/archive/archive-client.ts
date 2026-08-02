import { getSeedArchive } from "./seed";
import { loadLocalArchive, persistLocalArchive } from "./local-repository";
import { decodeArchiveSnapshot, decodeExtractedMemory, encodeExtractedMemory } from "./codecs";
import type { ArchiveSnapshot, ExtractedMemory, Story } from "./types";

export type ArchiveAuthMode = "mock" | "unconfigured" | null;
type RequestResult<T> = { value: T; source: "backend" | "local"; warning: string | null; authMode?: ArchiveAuthMode };

export const API_DEMO_FAMILY_ID = "10000000-0000-4000-8000-000000000001";
export const API_DEMO_SPEAKER_ID = "10000000-0000-4000-8000-000000000003";

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
}

async function requestJsonWithMetadata(path: string, init?: RequestInit): Promise<{ body: unknown; authMode: ArchiveAuthMode }> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(3500),
  });
  if (!response.ok) throw new Error(`Archive service returned ${response.status}`);
  const reportedAuth = response.headers.get("x-linger-auth-mode");
  return {
    body: response.status === 204 ? null : await response.json() as unknown,
    authMode: reportedAuth === "mock" || reportedAuth === "unconfigured" ? reportedAuth : null,
  };
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  return (await requestJsonWithMetadata(path, init)).body;
}

async function fetchBackendArchive(): Promise<{ snapshot: ArchiveSnapshot; authMode: ArchiveAuthMode }> {
  const result = await requestJsonWithMetadata(`/api/families/${API_DEMO_FAMILY_ID}/archive`);
  const decoded = decodeArchiveSnapshot(result.body);
  if (!decoded) throw new Error("Archive response did not match the validated contract");
  persistLocalArchive(decoded);
  return { snapshot: decoded, authMode: result.authMode };
}

export async function loadArchive(options: { preferBackend?: boolean } = {}): Promise<RequestResult<ArchiveSnapshot>> {
  if (options.preferBackend) {
    try {
      const decoded = await fetchBackendArchive();
      return { value: decoded.snapshot, source: "backend", warning: null, authMode: decoded.authMode };
    } catch {
      return {
        value: loadLocalArchive(),
        source: "local",
        warning: "The family archive service is offline. Changes will stay on this device and can be retried.",
        authMode: "mock",
      };
    }
  }
  return { value: loadLocalArchive(), source: "local", warning: null, authMode: "mock" };
}

export async function extractMemory(
  transcript: string,
): Promise<RequestResult<{ memory: ExtractedMemory }>> {
  try {
    const result = (await requestJson("/api/extractions", {
      method: "POST",
      body: JSON.stringify({ family_id: API_DEMO_FAMILY_ID, speaker_id: API_DEMO_SPEAKER_ID, session_id: crypto.randomUUID(), transcript }),
    })) as { extracted_memory?: unknown };
    const memory = decodeExtractedMemory(result.extracted_memory);
    if (!memory) throw new Error("Incomplete extraction response");
    return {
      value: { memory },
      source: "backend",
      warning: null,
    };
  } catch {
    throw new Error("Memory extraction is unavailable. The corrected transcript remains unsaved and can be exported or retried.");
  }
}

export async function confirmMemory(input: {
  originalMemory: ExtractedMemory;
  correctedMemory: ExtractedMemory;
  transcript: string;
  useBackend?: boolean;
  sharing?: "private" | "family";
}): Promise<RequestResult<ArchiveSnapshot>> {
  if (input.useBackend === false) {
    throw new Error("The reviewed memory remains unsaved. Reconnect the archive service and retry.");
  }
  try {
    const result = await requestJson("/api/extractions/confirm", {
      method: "POST",
      body: JSON.stringify({
        family_id: API_DEMO_FAMILY_ID,
        speaker_id: API_DEMO_SPEAKER_ID,
        transcript: input.transcript,
        original_memory: encodeExtractedMemory(input.originalMemory),
        corrected_memory: encodeExtractedMemory(input.correctedMemory),
        consent: true,
        sharing_permission: input.sharing ?? "private",
        retain_audio: false,
      }),
    });
    const nested = recordArchive(result);
    if (nested) {
      persistLocalArchive(nested);
      return { value: nested, source: "backend", warning: null };
    }
    throw new Error("Confirmed memory response omitted an archive snapshot");
  } catch {
    throw new Error("The reviewed memory remains unsaved. Reconnect the archive service and retry.");
  }
}

export async function checkBackend(): Promise<"online" | "offline"> {
  try {
    const response = await fetch(`${apiBase()}/health`, { signal: AbortSignal.timeout(1800) });
    return response.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}

export async function updateBackendStory(story: Story): Promise<ArchiveSnapshot> {
  await requestJson(`/api/stories/${encodeURIComponent(story.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: story.title,
      summary: story.summary,
      approximate_start_date: story.approximateDate === "Date not yet known" ? null : story.approximateDate,
      location: story.location === "Place not yet known" ? null : story.location,
      emotional_themes: story.emotionalThemes,
      sensitivity_level: story.sensitivityLevel,
      sharing_permission: story.sharing,
      unresolved_questions: story.unresolvedQuestions,
    }),
  });
  return (await fetchBackendArchive()).snapshot;
}

export async function deleteBackendStory(storyId: string): Promise<ArchiveSnapshot> {
  await requestJson(`/api/stories/${encodeURIComponent(storyId)}`, { method: "DELETE" });
  return (await fetchBackendArchive()).snapshot;
}

export function pristineArchive(): ArchiveSnapshot {
  return getSeedArchive();
}

function recordArchive(value: unknown): ArchiveSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const nested = (value as { archive?: unknown }).archive;
  return decodeArchiveSnapshot(nested ?? value);
}
