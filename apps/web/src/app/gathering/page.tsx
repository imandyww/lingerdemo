import type { Metadata } from "next";
import { GatheringScreen } from "@/components/gathering-screen";

export const metadata: Metadata = { title: "Family Gathering" };

export default function GatheringPage() {
  return <GatheringScreen />;
}
