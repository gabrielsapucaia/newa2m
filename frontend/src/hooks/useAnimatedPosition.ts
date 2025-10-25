import { useEffect, useRef, useState } from "react";

export function useAnimatedPosition(target: [number, number] | null, duration = 1000) {
  const [position, setPosition] = useState<[number, number] | null>(target);
  const fromRef = useRef<[number, number] | null>(target);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      setPosition(null);
      fromRef.current = null;
      return;
    }

    const from = fromRef.current ?? target;
    const to = target;

    if (!from) {
      setPosition(to);
      fromRef.current = to;
      return;
    }

    const animate = (timestamp: number) => {
      if (startRef.current === null) {
        startRef.current = timestamp;
      }
      const elapsed = timestamp - (startRef.current ?? 0);
      const progress = Math.min(elapsed / duration, 1);
      const lat = from[0] + (to[0] - from[0]) * progress;
      const lon = from[1] + (to[1] - from[1]) * progress;
      setPosition([lat, lon]);
      if (progress < 1) {
        frameRef.current = window.requestAnimationFrame(animate);
      } else {
        fromRef.current = to;
        startRef.current = null;
        frameRef.current = null;
      }
    };

    frameRef.current = window.requestAnimationFrame(animate);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      startRef.current = null;
    };
  }, [target, duration]);

  return position;
}
