import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container section narrow center">
      <h1>404</h1>
      <p className="muted">This page drifted away with the clouds.</p>
      <Link href="/" className="btn btn-ghost">
        Moment
      </Link>
    </div>
  );
}
