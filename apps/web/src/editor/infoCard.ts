/** Small DOM helpers shared by the completion panel and the hover cards. */

export interface InfoRow {
  label: string;
  /** One line, or several lines for a list of arguments or results. */
  value: string | string[];
}

export interface InfoExample {
  /** The label above the example, e.g. 'Example — "1 + 1 + 1"'. */
  label?: string;
  /** The code lines of the example. */
  lines: string[];
}

export function infoCard(options: {
  title: string;
  badge?: string;
  /** The short description of the thing, shown under the title. */
  description?: string;
  rows?: InfoRow[];
  example?: InfoExample;
  code?: string;
  note?: string;
}): HTMLElement {
  const root = document.createElement("div");
  root.className = "lf-info";

  const head = document.createElement("div");
  head.className = "lf-info-head";
  const title = document.createElement("strong");
  title.className = "lf-info-title";
  title.textContent = options.title;
  head.appendChild(title);
  if (options.badge) {
    const badge = document.createElement("span");
    badge.className = "lf-info-badge";
    badge.textContent = options.badge;
    head.appendChild(badge);
  }
  root.appendChild(head);

  if (options.description) {
    const description = document.createElement("p");
    description.className = "lf-info-desc";
    description.textContent = options.description;
    root.appendChild(description);
  }

  if (options.rows && options.rows.length > 0) {
    const list = document.createElement("dl");
    list.className = "lf-info-rows";
    for (const row of options.rows) {
      const term = document.createElement("dt");
      term.textContent = row.label;
      const value = document.createElement("dd");
      if (Array.isArray(row.value)) {
        for (const line of row.value) {
          const item = document.createElement("div");
          item.className = "lf-info-item";
          item.textContent = line;
          value.appendChild(item);
        }
      } else {
        value.textContent = row.value;
      }
      list.appendChild(term);
      list.appendChild(value);
    }
    root.appendChild(list);
  }

  if (options.example && options.example.lines.length > 0) {
    const example = document.createElement("div");
    example.className = "lf-info-example";
    if (options.example.label) {
      const label = document.createElement("span");
      label.className = "lf-info-example-label";
      label.textContent = options.example.label;
      example.appendChild(label);
    }
    const code = document.createElement("code");
    code.className = "lf-info-example-code";
    code.textContent = options.example.lines.join("\n");
    example.appendChild(code);
    root.appendChild(example);
  }

  if (options.code) {
    const code = document.createElement("code");
    code.className = "lf-info-code";
    code.textContent = options.code;
    root.appendChild(code);
  }

  if (options.note) {
    const note = document.createElement("p");
    note.className = "lf-info-note";
    note.textContent = options.note;
    root.appendChild(note);
  }

  return root;
}
