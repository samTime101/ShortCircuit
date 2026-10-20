/** Small DOM helpers shared by the completion panel and the hover cards. */

export interface InfoRow {
  label: string;
  value: string;
}

export function infoCard(options: {
  title: string;
  badge?: string;
  rows?: InfoRow[];
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

  if (options.rows && options.rows.length > 0) {
    const list = document.createElement("dl");
    list.className = "lf-info-rows";
    for (const row of options.rows) {
      const term = document.createElement("dt");
      term.textContent = row.label;
      const value = document.createElement("dd");
      value.textContent = row.value;
      list.appendChild(term);
      list.appendChild(value);
    }
    root.appendChild(list);
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
