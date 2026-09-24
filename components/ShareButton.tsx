"use client";

export function ShareButton({ url, title, label }: { url: string; title: string; label: string }) {
  return (
    <button
      type="button"
      className="btn btn-primary"
      onClick={async () => {
        if (navigator.share) {
          try {
            await navigator.share({ title, url });
          } catch {
            /* dismissed */
          }
        } else {
          await navigator.clipboard?.writeText(url);
          alert(url);
        }
      }}
    >
      {label}
    </button>
  );
}
