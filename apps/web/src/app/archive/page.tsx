import type { Metadata } from "next";
import { ArchiveScreen } from "@/components/archive-screen";

export const metadata: Metadata = { title: "Family archive" };

export default function ArchivePage() {
  return <ArchiveScreen />;
}
