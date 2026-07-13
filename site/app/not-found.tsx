import Link from "next/link";

export default function NotFound() {
  return (
    <section className="not-found shell">
      <span className="eyebrow">404 / Record not found</span>
      <h1>This trail ends here.</h1>
      <p>The page may have moved, or the citation was never added.</p>
      <Link className="button" href="/">Return home</Link>
    </section>
  );
}
