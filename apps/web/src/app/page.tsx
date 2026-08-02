import type { Metadata } from "next";
import { ConversationScreen } from "@/components/conversation-screen";

export const metadata: Metadata = { title: "Live conversation" };

export default function HomePage() {
  return <ConversationScreen />;
}
