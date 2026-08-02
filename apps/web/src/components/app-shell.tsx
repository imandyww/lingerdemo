"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const navigation = [
  { href: "/", label: "Talk" },
  { href: "/archive", label: "Archive" },
  { href: "/gathering", label: "Gathering" },
  { href: "/demo", label: "Guided demo" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [textScale, setTextScale] = useState(() => {
    if (typeof window === "undefined") return 1;
    const stored = Number(window.localStorage.getItem("linger:text-scale"));
    return stored >= 1 && stored <= 1.18 ? stored : 1;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--text-scale", String(textScale));
    window.localStorage.setItem("linger:text-scale", String(textScale));
  }, [textScale]);

  return (
    <div className={`app-frame ${pathname === "/" ? "home-frame" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {pathname !== "/" ? <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Linger home">
          <span className="wordmark-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Linger</span>
        </Link>
        <nav className="primary-nav" aria-label="Main navigation">
          {navigation.map((item) => {
            const active = item.href === "/" ? pathname === "/" || pathname === "/conversation" : pathname.startsWith(item.href);
            return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>{item.label}</Link>;
          })}
        </nav>
        <div className="text-size-control" aria-label="Text size">
          <span aria-hidden="true">Aa</span>
          <button type="button" onClick={() => setTextScale((scale) => Math.max(1, Number((scale - 0.06).toFixed(2))))} aria-label="Decrease text size">−</button>
          <button type="button" onClick={() => setTextScale((scale) => Math.min(1.18, Number((scale + 0.06).toFixed(2))))} aria-label="Increase text size">+</button>
        </div>
      </header> : null}
      {children}
      {pathname !== "/" ? <footer className="site-footer">
        <p>Stories stay private until your family chooses to share them.</p>
        <p className="footer-philosophy">AI does not create conversations. It catches conversations that almost happened.</p>
      </footer> : null}
    </div>
  );
}
