import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "./Icons";

interface ModalProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onClose(): void;
  children: ReactNode;
  size?: "wide" | "default";
}

export function Modal({
  eyebrow,
  title,
  subtitle,
  onClose,
  children,
  size = "default",
}: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className={`modal-card ${size === "wide" ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <div>
            {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button className="icon-button modal-close" onClick={onClose} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
