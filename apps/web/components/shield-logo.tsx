export function ShieldLogo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 72" className={className} aria-hidden="true">
      <path d="M32 2 60 12v24c0 17-12 29-28 34C16 65 4 53 4 36V12Z" fill="var(--color-clay)" />
      <circle cx="22" cy="34" r="3.2" fill="var(--color-forest)" />
      <circle cx="42" cy="34" r="3.2" fill="var(--color-forest)" />
      <path d="M22 46c6 5 14 5 20 0" stroke="var(--color-cream)" strokeWidth="3.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
