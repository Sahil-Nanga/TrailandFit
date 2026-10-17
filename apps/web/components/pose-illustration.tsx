/** Simple figure showing the photo pose: facing forward, arms a little out, feet apart. */
export function PoseIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 200"
      role="img"
      aria-label="A person standing straight, facing the camera, arms held slightly away from the body, feet hip-width apart."
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="60" cy="24" r="14" fill="currentColor" stroke="none" />
      <path d="M60 42 V108" />
      <path d="M38 50 H82" />
      <path d="M38 50 L24 98 L20 120" />
      <path d="M82 50 L96 98 L100 120" />
      <path d="M60 108 L46 150 L44 190" />
      <path d="M60 108 L74 150 L76 190" />
    </svg>
  );
}
