import type { Metadata } from "next";

import { ProfileList } from "@/components/profile-list";

export const metadata: Metadata = { title: "My profiles" };

export default function ProfilesPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">My profiles</h1>
      <ProfileList />
    </div>
  );
}
