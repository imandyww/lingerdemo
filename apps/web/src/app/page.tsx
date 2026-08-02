import type { Metadata } from "next";
import { HomeScreen } from "@/components/home-screen";

export const metadata: Metadata = { title: "Keep the stories that matter" };

export default function HomePage() {
  return <HomeScreen />;
}
