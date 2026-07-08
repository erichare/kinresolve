import Link from "next/link";
import { Icons } from "./icons";

const links = [
  { href: "/", label: "Public Archive" },
  { href: "/people", label: "People" },
  { href: "/places", label: "Places" },
  { href: "/stories", label: "Stories" },
  { href: "/kinsleuth", label: "Product" }
];

export function PublicShell({ children, active = "/" }: { children: React.ReactNode; active?: string }) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <nav className="public-nav" aria-label="Public navigation">
          <Link className="brand" href="/">
            <span className="brand-mark">
              <Icons.TreePine size={22} aria-hidden />
            </span>
            <span>
              KinSleuth
              <small>Family history. Openly shared.</small>
            </span>
          </Link>
          <div className="nav-links">
            {links.map((link) => (
              <Link className={active === link.href ? "active" : undefined} href={link.href} key={link.href}>
                {link.label}
              </Link>
            ))}
          </div>
          <Link className="button-secondary" href="/login">
            <Icons.Lock size={16} aria-hidden />
            Private workspace
          </Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="public-footer">
        <div className="footer-inner">
          <Link className="brand" href="/">
            <span className="brand-mark">
              <Icons.TreePine size={18} aria-hidden />
            </span>
            <span>KinSleuth</span>
          </Link>
          <span>MIT licensed self-hosted genealogy investigation software.</span>
        </div>
      </footer>
    </div>
  );
}

