import Link from "next/link";
import { Suspense } from "react";

import { AuthNav } from "@/components/auth-nav";
import { MainNav } from "@/components/main-nav";
import { ProfileSwitcher } from "@/components/profile-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between gap-3 px-4">
        <Link
          href="/"
          className="rounded-md font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="text-primary">Trialandfit</span>
        </Link>
        <div className="flex items-center gap-2">
          <ProfileSwitcher />
          <AuthNav />
          <ThemeToggle />
        </div>
      </div>
      {/* MainNav reads the current URL, which is request-time data (Cache Components). */}
      <Suspense fallback={null}>
        <MainNav />
      </Suspense>
    </header>
  );
}
