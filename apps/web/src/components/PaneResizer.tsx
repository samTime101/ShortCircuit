import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface PaneResizerProps {
  /** The direction the bar itself runs. A horizontal bar changes heights. */
  orientation: "horizontal" | "vertical";
  /** Accessible name for the bar. */
  label: string;
  /** Current size, used for the separator value readout. */
  value: number;
  min: number;
  max: number;
  /** Pointer movement along the resize axis, in pixels. */
  onDrag(delta: number): void;
  /** Called once when a drag begins, before the first movement. */
  onStart?(): void;
  /** Keyboard resize step, in pixels. Positive grows the first pane. */
  onNudge(delta: number): void;
  /** Home and End move straight to the limits. */
  onEdge(edge: "start" | "end"): void;
  /** Double click returns the pane to its default size. */
  onReset(): void;
}

const KEY_STEP = 16;

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is an enhancement; dragging still works without it.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
  } catch {
    // There is nothing to release.
  }
}

export function PaneResizer({
  orientation,
  label,
  value,
  min,
  max,
  onDrag,
  onStart,
  onNudge,
  onEdge,
  onReset,
}: PaneResizerProps) {
  const origin = useRef<number | null>(null);
  const bodyClass = orientation === "horizontal" ? "is-resizing-rows" : "is-resizing-columns";

  // A drag that ends outside the window should not leave the page stuck with
  // a resize cursor.
  useEffect(() => () => document.body.classList.remove(bodyClass), [bodyClass]);

  const stop = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current === null) return;
    origin.current = null;
    document.body.classList.remove(bodyClass);
    releasePointer(event.currentTarget, event.pointerId);
  };

  return (
    <div
      className={`pane-resizer ${orientation}`}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      title={`${label}. Drag or use the arrow keys. Double click to reset.`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        origin.current = orientation === "horizontal" ? event.clientY : event.clientX;
        document.body.classList.add(bodyClass);
        capturePointer(event.currentTarget, event.pointerId);
        onStart?.();
      }}
      onPointerMove={(event) => {
        if (origin.current === null) return;
        const point = orientation === "horizontal" ? event.clientY : event.clientX;
        onDrag(point - origin.current);
        origin.current = point;
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        const grow = orientation === "horizontal" ? "ArrowDown" : "ArrowRight";
        const shrink = orientation === "horizontal" ? "ArrowUp" : "ArrowLeft";
        if (event.key === grow) {
          event.preventDefault();
          onNudge(KEY_STEP);
        } else if (event.key === shrink) {
          event.preventDefault();
          onNudge(-KEY_STEP);
        } else if (event.key === "Home") {
          event.preventDefault();
          onEdge("start");
        } else if (event.key === "End") {
          event.preventDefault();
          onEdge("end");
        }
      }}
    />
  );
}
