import Link from "next/link";

import { AuthNav } from "@/components/auth-nav";

export function SiteHeader() {
  return (
    <header className="border-b">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4"
      >
        <Link
          href="/"
          className="rounded-md font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          Aurora
        </Link>
        <AuthNav />
      </nav>
    </header>
  );
}
