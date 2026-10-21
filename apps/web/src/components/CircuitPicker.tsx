import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown } from "./Icons";

interface CircuitPickerProps {
  circuits: string[];
  value: string;
  onChange(name: string): void;
}

export function CircuitPicker({ circuits, value, onChange }: CircuitPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listID = useId();
  const selectedIndex = Math.max(0, circuits.indexOf(value));

  useEffect(() => {
    if (!open) setHighlightedIndex(selectedIndex);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const option = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlightedIndex}"]`);
    option?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlightedIndex]);

  const openMenu = (index = selectedIndex) => {
    setHighlightedIndex(Math.max(0, index));
    setOpen(true);
  };

  const commit = (index: number) => {
    const name = circuits[index];
    if (name && name !== value) onChange(name);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      case "ArrowDown":
        event.preventDefault();
        setHighlightedIndex((current) => Math.min(circuits.length - 1, current + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setHighlightedIndex((current) => Math.max(0, current - 1));
        break;
      case "Home":
        event.preventDefault();
        setHighlightedIndex(0);
        break;
      case "End":
        event.preventDefault();
        setHighlightedIndex(circuits.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(highlightedIndex);
        break;
    }
  };

  return (
    <div className={`circuit-picker ${open ? "is-open" : ""}`} ref={rootRef}>
      <span className="circuit-picker-label">Circuit</span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="circuit-picker-trigger"
        aria-label={`Active circuit: ${value}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listID}
        aria-activedescendant={open ? `${listID}-${highlightedIndex}` : undefined}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="circuit-picker-value">{value}</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      {open ? (
        <div
          id={listID}
          ref={listRef}
          className="circuit-picker-menu"
          role="listbox"
          aria-label="Circuits"
        >
          {circuits.map((name, index) => (
            <button
              key={name}
              id={`${listID}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={name === value}
              className={`circuit-picker-option ${index === highlightedIndex ? "is-highlighted" : ""}`}
              data-index={index}
              onPointerEnter={() => setHighlightedIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commit(index)}
            >
              <span>{name}</span>
              {name === value ? <Check size={12} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
