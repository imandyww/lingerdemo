import type { Metadata } from "next";
import { DemoExperience } from "@/components/demo-experience";

export const metadata: Metadata = { title: "Three-minute guided demo" };

export default function DemoPage() {
  return <DemoExperience />;
}
