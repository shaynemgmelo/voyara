import { useEffect, useRef, useState } from "react";

/**
 * LazyMount — only renders children when the placeholder enters the viewport.
 * Used for heavy components (Google Maps, animated demos) that we don't want
 * paying for on initial paint of the landing page.
 *
 * Usage:
 *   <LazyMount minHeight={400}><HeroDemo /></LazyMount>
 *
 * Once triggered, stays mounted (unmounting on scroll-away would be worse
 * than keeping it).
 */
export default function LazyMount({ children, minHeight = 300, rootMargin = "200px" }) {
  const ref = useRef(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (mounted) return;
    const el = ref.current;
    if (!el) return;
    // `IntersectionObserver` is available everywhere modern. No fallback —
    // if a browser is that old, just mount eagerly.
    if (typeof IntersectionObserver === "undefined") {
      setMounted(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setMounted(true);
          obs.disconnect();
        }
      },
      { rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [mounted, rootMargin]);

  return (
    <div ref={ref} style={{ minHeight: mounted ? undefined : minHeight }}>
      {mounted ? children : null}
    </div>
  );
}
