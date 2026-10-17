"use client";

import { UserRound } from "lucide-react";

import { useActiveProfile } from "@/components/active-profile";

/** Top-right picker for the profile used for sizes and try-on (here and in the extension). */
export function ProfileSwitcher() {
  const { profiles, active, setActive } = useActiveProfile();
  if (!profiles || profiles.length === 0 || !active) return null;

  return (
    <label className="flex items-center gap-1.5 rounded-md border bg-background pr-1 pl-2 text-sm focus-within:ring-3 focus-within:ring-ring/50">
      <UserRound aria-hidden className="size-4 text-primary" />
      <span className="sr-only">Active profile</span>
      <select
        value={active.id}
        onChange={(event) => void setActive(event.target.value)}
        className="max-w-[9rem] cursor-pointer truncate bg-transparent py-1 font-medium outline-none"
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </label>
  );
}
