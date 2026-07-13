import Link from "next/link";

export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link className={footer ? "brand brand-footer" : "brand"} href="/" aria-label="Kin Resolve home">
      <span className="brand-mark" aria-hidden="true">
        <span>K</span>
        <span>R</span>
      </span>
      <span className="brand-wordmark">
        <strong>Kin Resolve</strong>
        {!footer && <small>Evidence-led genealogy</small>}
      </span>
    </Link>
  );
}
