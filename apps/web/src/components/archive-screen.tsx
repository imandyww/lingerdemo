"use client";

import { useArchive } from "@/hooks/use-archive";
import { ArchiveView } from "./archive-view";
import { WifiIcon } from "./icons";

export function ArchiveScreen() {
  const { archive, loading, warning, source, authMode, refresh, saveStory, deleteStory } = useArchive({ preferBackend: true });
  return (
    <main id="main-content" className="archive-page">
      <header className="page-header archive-page-header">
        <div><p className="eyebrow"><span /> The {archive.family.familyName} collection</p><h1>A living archive, told in their own words.</h1><p>{archive.stories.length} stories across {archive.lifeEvents.length} life moments, with questions for the next conversation.</p></div>
        <div className="archive-freshness"><span className={source === "backend" ? "online" : "local"} /><strong>{loading ? "Opening archive…" : source === "backend" ? authMode === "mock" ? "Backend archive · mock identity" : "Backend archive · authentication unconfigured" : "Local demo archive · mock identity"}</strong><small>{source === "backend" ? `${authMode === "mock" ? "No application sign-in" : "Not a production family account"} · updated ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(archive.updatedAt))}` : "No application sign-in · this device only"}</small></div>
      </header>
      {warning ? <div className="notice notice-offline" role="status"><WifiIcon width="23" height="23" /><div><strong>Working locally</strong><p>{warning}</p></div><button type="button" onClick={() => void refresh()}>Retry connection</button></div> : null}
      <ArchiveView archive={archive} onUpdateStory={(story) => void saveStory(story)} onDeleteStory={(storyId) => void deleteStory(storyId)} />
    </main>
  );
}
