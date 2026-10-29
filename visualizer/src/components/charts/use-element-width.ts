import { useCallback, useRef, useState } from "react";

/** Width of an element, updated on resize; 0 until it has been measured. */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((node: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    setWidth(Math.round(node.getBoundingClientRect().width));
    observer.current = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width);
      setWidth((current) => (current === next ? current : next));
    });
    observer.current.observe(node);
  }, []);
  return [ref, width];
}
