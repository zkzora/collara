import type { Metadata } from "next";
import { NotificationsView } from "./notifications-view";

export const metadata: Metadata = { title: "Notifications" };

/** P1: a minimal in-app inbox (S L131). Items carry a generic event and an authenticated link only. */
export default function NotificationsPage() {
  return <NotificationsView />;
}
