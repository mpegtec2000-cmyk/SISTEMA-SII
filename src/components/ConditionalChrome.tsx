"use client";

import { usePathname } from "next/navigation";

export function HeaderChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/personas") || pathname?.startsWith("/dashboard")) return null;
  return <>{children}</>;
}

export function FooterChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith("/personas") || pathname?.startsWith("/dashboard")) return null;
  return <>{children}</>;
}
