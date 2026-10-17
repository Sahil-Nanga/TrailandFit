"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/lib/auth";

const LINKS = [
  { href: "/", label: "Measure" },
  { href: "/wardrobe", label: "Wardrobe" },
  { href: "/try-on", label: "Try on" },
  { href: "/profiles", label: "Profiles" },
];

/** Section links, shown once signed in. Scrolls sideways on narrow screens. */
export function MainNav() {
  const auth = useAuth();
  const pathname = usePathname();
  if (auth.status !== "signed-in") return null;

  return (
    <nav aria-label="Main" className="mx-auto w-full max-w-4xl overflow-x-auto px-2">
      <ul className="flex gap-1">
        {LINKS.map(({ href, label }) => {
          const current = href === "/" ? pathname === "/" || pathname.startsWith("/measure") : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className="block border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground"
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
