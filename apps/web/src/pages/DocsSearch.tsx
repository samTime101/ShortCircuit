import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Search } from "../components/Icons";
import { searchDocs, type DocsSearchEntry, type DocsSearchKind } from "./docsSearch";

const KIND_LABEL: Record<DocsSearchKind, string> = {
  section: "section",
  glossary: "term",
  "built-in": "built in",
  package: "package",
  macro: "macro",
  circuit: "circuit",
  snippet: "snippet",
};

interface DocsSearchProps {
  entries: readonly DocsSearchEntry[];
  onJump(id: string): void;
}

export function DocsSearch({ entries, onJump }: DocsSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchDocs(entries, query), [entries, query]);
  const showPanel = open && query.trim().length > 0;

  useEffect(() => {
    setActive(results.length > 0 ? 0 : -1);
  }, [query, results.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (typing) return;
      const shortcut =
        event.key === "/" || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k");
      if (!shortcut) return;
      event.preventDefault();
      inputRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const choose = (entry: DocsSearchEntry) => {
    onJump(entry.id);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!showPanel || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current - 1 + results.length) % results.length);
      return;
    }
    if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      const entry = results[active];
      if (entry) choose(entry);
    }
  };

  return (
    <div className="docs-search" ref={containerRef}>
      <Search size={14} />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search documentation"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={showPanel}
        aria-controls="docs-search-results"
        aria-activedescendant={showPanel && active >= 0 ? `docs-search-option-${active}` : undefined}
        placeholder="Search syntax, functions, packages"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd aria-hidden="true">/</kbd>

      {showPanel ? (
        <div
          className="docs-search-panel"
          id="docs-search-results"
          role="listbox"
          aria-label="Search results"
        >
          {results.length === 0 ? (
            <p className="docs-search-empty">No matches for &quot;{query.trim()}&quot;.</p>
          ) : (
            results.map((result, index) => (
              <button
                type="button"
                role="option"
                id={`docs-search-option-${index}`}
                key={`${result.kind}-${result.id}`}
                aria-selected={index === active}
                className={index === active ? "is-active" : undefined}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(result)}
              >
                <span className="docs-search-kind">{KIND_LABEL[result.kind]}</span>
                <span className="docs-search-copy">
                  <strong>{result.title}</strong>
                  {result.subtitle ? <small>{result.subtitle}</small> : null}
                </span>
                {result.group ? <span className="docs-search-group">{result.group}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
