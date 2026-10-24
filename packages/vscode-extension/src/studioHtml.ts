import type { GraphLayout } from "./graphLayout";
import type {
  StudioCircuitData,
  StudioDiagnostic,
  StudioHtmlOptions,
  StudioModel,
  StudioSnapshot,
  StudioTestCase,
  StudioTestRow,
  StudioTestSuite,
  StudioTests,
  StudioTruthTable,
  StudioWaveform,
} from "./studioModel";

export type {
  StudioCircuitData,
  StudioDiagnostic,
  StudioHtmlOptions,
  StudioModel,
  StudioSnapshot,
  StudioTestCase,
  StudioTestRow,
  StudioTestSuite,
  StudioTests,
  StudioTruthTable,
  StudioWaveform,
};

function serializeModel(model: StudioModel | null): string {
  return JSON.stringify(model)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function getStudioHtml(
  initialModel: StudioModel | null,
  options: StudioHtmlOptions = {},
): string {
  const modelJson = serializeModel(initialModel);
  const initialTabJson = JSON.stringify(options.initialTab ?? "circuit");
  const version = options.version ?? "0.1.3";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Short Circuit Studio</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background, #040507);
      --bg-deep: var(--vscode-sideBar-background, #020203);
      --panel: var(--vscode-sideBar-background, #060709);
      --panel-2: var(--vscode-editorWidget-background, #0a0c0f);
      --panel-3: #0e1114;
      --line: var(--vscode-panel-border, #13161a);
      --line-strong: var(--vscode-focusBorder, #1c2027);
      --text: var(--vscode-editor-foreground, #dee2e9);
      --text-dim: var(--vscode-descriptionForeground, #949ca9);
      --text-faint: #656d79;

      --accent: #6c9eff;
      --accent-strong: #9dc0ea;
      --accent-soft: rgba(108, 158, 255, 0.14);
      --violet: #9b8ce8;
      --orange: #e2a072;
      --yellow: #dcb862;
      --red: #e87878;
      --green: #6cc48f;
      --lime: #d1ff52;

      --fs-2xs: 10.5px;
      --fs-xs: 11.5px;
      --fs-sm: 12.5px;
      --fs-base: 13.5px;
      --fs-md: 15px;

      --font-ui: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --font-mono: var(--vscode-editor-font-family, "JetBrains Mono", Consolas, "Courier New", monospace);
      --radius: 6px;
      --radius-sm: 4px;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--font-ui);
      background-color: var(--bg);
      color: var(--text);
      font-size: var(--fs-sm);
      line-height: 1.4;
      overflow-x: hidden;
      display: flex;
      flex-direction: column;
      height: 100vh;
      user-select: none;
    }

    /* Top Bar */
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 6px 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
      flex-shrink: 0;
    }

    .tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
    }

    .tab-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      color: var(--text-faint);
      cursor: pointer;
      font-size: var(--fs-xs);
      font-weight: 500;
      transition: color 0.14s ease, border-color 0.14s ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      color: var(--text-dim);
    }

    .tab-btn.active {
      border-bottom-color: var(--accent);
      color: var(--text);
    }

    .tab-badge {
      font-size: var(--fs-2xs);
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--panel-3);
      color: var(--text-faint);
      font-family: var(--font-mono);
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .version-tag {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-faint);
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      border: 1px solid var(--line);
      user-select: none;
      white-space: nowrap;
    }

    .circuit-select {
      height: 24px;
      background: var(--panel-2);
      border: 1px solid var(--line-strong);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      padding: 0 6px;
      cursor: pointer;
      max-width: 180px;
      outline: none;
      transition: border-color 0.14s ease;
    }

    .circuit-select:hover, .circuit-select:focus {
      border-color: var(--lime);
    }

    .circuit-select option {
      background: #0a0c0f;
      color: #dee2e9;
    }

    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 24px;
      padding: 0 8px;
      background: transparent;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      font-size: var(--fs-xs);
      cursor: pointer;
      transition: all 0.14s ease;
    }

    .btn-action:hover {
      background: var(--panel-2);
      border-color: var(--line-strong);
      color: var(--text);
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .btn-action.is-refreshing svg {
      animation: spin 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* Diagnostics Banner */
    .diagnostics-banner {
      display: none;
      padding: 6px 12px;
      background: rgba(239, 68, 68, 0.12);
      border-bottom: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: var(--fs-xs);
      align-items: center;
      gap: 8px;
    }

    /* Views */
    .view-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      min-height: 0;
    }

    .tab-content {
      display: none;
      height: 100%;
      flex-direction: column;
      overflow: hidden;
    }

    .tab-content.active {
      display: flex;
    }

    /* ---------------- Simulator Dock (Exact Web Port) ---------------- */
    .sim-dock {
      display: flex;
      flex-direction: column;
      background: var(--panel);
      height: var(--sim-dock-height, 220px);
      min-height: 90px;
      max-height: 80%;
      overflow: hidden;
      flex-shrink: 0;
    }

    .sim-dock-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px 10px;
      min-height: 34px;
      padding: 5px 12px;
      border-bottom: 1px solid var(--line);
    }

    .sim-dock-title {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-dim);
      font-size: var(--fs-sm);
      font-weight: 600;
      white-space: nowrap;
    }

    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 6px var(--green);
      animation: pulse 2.4s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.9); }
    }

    .event-chip {
      padding: 1px 6px;
      border: 1px solid var(--line-strong);
      border-radius: 3px;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
    }

    .dock-controls-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }

    .dock-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .dock-select {
      height: 22px;
      padding: 0 6px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      cursor: pointer;
    }

    .dock-select:hover {
      border-color: var(--line-strong);
      color: var(--text);
    }

    .dock-select:focus {
      border-color: var(--accent);
      outline: none;
    }

    .text-button {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-dim);
      font-size: var(--fs-sm);
      cursor: pointer;
      transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
    }

    .text-button:hover {
      border-color: var(--line-strong);
      background: var(--panel-2);
      color: var(--text);
    }

    .text-button.compact {
      height: 22px;
      font-size: var(--fs-xs);
    }

    .text-button.is-active {
      border-color: var(--accent);
      background: var(--accent-soft);
      color: var(--accent-strong);
    }

    .text-button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .sim-dock-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .sim-clock-hint {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--text-faint);
      font-size: var(--fs-xs);
      white-space: nowrap;
    }

    .sim-columns {
      display: grid;
      flex: 1;
      grid-template-columns: minmax(0, var(--sim-split, 50%)) 10px minmax(0, 1fr);
      min-height: 0;
      overflow: hidden;
      padding: 10px 12px;
      gap: 0;
    }

    .sim-group {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding: 0 4px;
    }

    /* ---------------- Pane Resizers (Exact Web Port) ---------------- */
    .pane-resizer {
      position: relative;
      flex: none;
      touch-action: none;
      user-select: none;
      background: var(--panel);
      transition: background 120ms ease;
      z-index: 6;
    }

    .pane-resizer.vertical {
      width: 10px;
      cursor: col-resize;
    }

    .pane-resizer.horizontal {
      height: 10px;
      cursor: row-resize;
      border-bottom: 1px solid var(--line);
    }

    .pane-resizer.vertical::before {
      content: "";
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      background: var(--line);
      transform: translateX(-50%);
    }

    .pane-resizer.vertical::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 3px;
      height: 34px;
      border-radius: 2px;
      background: var(--line-strong);
      transform: translate(-50%, -50%);
    }

    .pane-resizer.horizontal::before {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 38px;
      height: 3px;
      border-radius: 2px;
      background: var(--line-strong);
      transform: translate(-50%, -50%);
    }

    .pane-resizer:hover,
    .pane-resizer:active {
      background: var(--panel-2);
    }

    .pane-resizer:hover::before,
    .pane-resizer:hover::after,
    .pane-resizer:focus-visible::before,
    .pane-resizer:focus-visible::after {
      background: var(--accent);
    }

    .pane-resizer:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: -2px;
      border-radius: 0;
    }

    body.is-resizing-rows,
    body.is-resizing-rows * {
      cursor: row-resize !important;
      user-select: none !important;
    }

    body.is-resizing-columns,
    body.is-resizing-columns * {
      cursor: col-resize !important;
      user-select: none !important;
    }

    .sim-group-title {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-bottom: 8px;
      color: var(--text-faint);
      font-size: var(--fs-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .group-count {
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--panel-3);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
    }

    .io-list, .monitor-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
    }

    .io-empty {
      padding: 8px 0;
      color: var(--text-faint);
      font-size: var(--fs-xs);
    }

    .io-control {
      display: flex;
      flex-direction: column;
      gap: 5px;
      padding: 7px 9px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }

    .bit-control {
      flex-direction: row;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .io-label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .io-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      font-weight: 500;
    }

    .io-label svg {
      color: var(--accent);
      flex-shrink: 0;
    }

    .io-width {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
    }

    /* Bit switch track and thumb (Matches web styles.css) */
    .bit-switch {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
    }

    .bit-switch-track {
      position: relative;
      width: 30px;
      height: 16px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--panel-3);
      transition: background 0.16s ease, border-color 0.16s ease;
    }

    .bit-switch-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--text-faint);
      transition: transform 0.16s ease, background 0.16s ease;
    }

    .bit-switch.is-on .bit-switch-track {
      border-color: var(--accent);
      background: var(--accent-soft);
    }

    .bit-switch.is-on .bit-switch-thumb {
      transform: translateX(14px);
      background: var(--accent);
    }

    .bit-switch-value {
      width: 10px;
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      text-align: right;
    }

    .bit-switch.is-on .bit-switch-value {
      color: var(--accent);
      font-weight: 600;
    }

    /* Bus controls */
    .bus-control {
      gap: 6px;
    }

    .bus-cells-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
    }

    .bus-wide-row {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
    }

    .bus-text-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }

    .bus-text-input {
      width: 100%;
      padding: 4px 7px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--panel-3);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      letter-spacing: 0.06em;
    }

    .bus-text-input:focus {
      border-color: var(--accent);
      outline: none;
    }

    .decimal-value.bus-decimal {
      white-space: nowrap;
      color: var(--accent);
      background: var(--accent-soft);
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      font-variant-numeric: tabular-nums;
    }

    .bit-cells {
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
    }

    .bit-cell {
      width: 19px;
      height: 22px;
      border: 1px solid var(--line);
      border-radius: 3px;
      background: var(--panel-3);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }

    .bit-cell:hover {
      border-color: var(--line-strong);
      color: var(--text-dim);
    }

    .bit-cell.is-on {
      border-color: rgba(108, 158, 255, 0.4);
      background: var(--accent-soft);
      color: var(--accent);
      font-weight: 600;
    }

    /* Output rows */
    .monitor-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--panel-2);
    }

    .monitor-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
    }

    .monitor-led {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--line-strong);
      flex: none;
    }

    .monitor-led.hot {
      background: var(--accent);
      box-shadow: 0 0 6px var(--accent);
    }

    .monitor-value {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      justify-content: flex-end;
      gap: 8px;
      min-width: 0;
      margin-left: auto;
    }

    .output-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 24px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      font-weight: 600;
      background: var(--panel-3);
      color: var(--text-faint);
      border: 1px solid var(--line);
    }

    .output-pill.high {
      background: var(--accent-soft);
      color: var(--accent);
      border-color: var(--accent);
      box-shadow: 0 0 8px var(--accent-soft);
    }

    .display-number {
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
    }

    .binary-value {
      color: var(--text);
      font-family: var(--font-mono);
      font-size: var(--fs-sm);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.04em;
    }

    .decimal-value {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      font-variant-numeric: tabular-nums;
    }

    .display-mode-select {
      background: var(--panel-3);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      color: var(--text-dim);
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
      height: 20px;
      padding: 0 4px;
      cursor: pointer;
    }

    .display-mode-select:focus {
      border-color: var(--accent);
      outline: none;
    }

    .display-leds {
      display: inline-flex;
      gap: 3px;
      align-items: center;
    }

    .led-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--line-strong);
    }

    .led-dot.on {
      background: var(--accent);
      box-shadow: 0 0 5px var(--accent);
    }

    .bar-track {
      width: 60px;
      height: 8px;
      background: var(--panel-3);
      border-radius: 4px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--accent);
      transition: width 0.2s ease;
    }

    .seven-seg-svg {
      display: inline-block;
      vertical-align: middle;
    }

    /* Stored State section */
    .state-block {
      margin-top: 6px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
    }

    .state-title {
      margin-bottom: 6px;
      color: var(--text-faint);
      font-size: var(--fs-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .state-glyph {
      color: var(--orange);
      font-family: var(--font-mono);
      font-weight: 700;
      font-size: var(--fs-xs);
    }

    /* ---------------- Evaluation Graph Toolbar (Matches Web UI) ---------------- */
    .graph-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 34px;
      padding: 0 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      flex-shrink: 0;
    }

    .graph-toolbar-title {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      color: var(--text);
      font-size: var(--fs-sm);
      font-weight: 600;
    }

    .graph-toolbar-title > div {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .graph-toolbar-title strong {
      color: var(--text);
    }

    .graph-toolbar-title span {
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      font-weight: 400;
    }

    .graph-mode {
      padding: 1px 6px;
      border: 1px solid var(--line-strong);
      border-radius: 3px;
      color: var(--text-faint);
      font-size: var(--fs-2xs);
      font-family: var(--font-mono);
    }

    .graph-mode.sequential {
      border-color: rgba(157, 141, 251, 0.4);
      color: var(--violet);
    }

    /* ---------------- Circuit Graph Stage (Web UI CircuitGraph.tsx Port) ---------------- */
    .graph-stage {
      position: relative;
      flex: 1;
      min-height: 200px;
      overflow: hidden;
      background:
        linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
      background-size: 28px 28px;
    }

    .circuit-graph {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      user-select: none;
      cursor: grab;
    }

    .graph-stage.is-dragging,
    .circuit-graph.is-dragging {
      cursor: grabbing;
    }

    .graph-overlay {
      position: absolute;
      display: flex;
      gap: 10px;
      align-items: center;
      padding: 4px 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: rgba(4, 5, 7, 0.88);
      color: var(--text-faint);
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
      pointer-events: none;
      z-index: 5;
    }

    .graph-legend {
      top: 10px;
      left: 12px;
    }

    .graph-layers {
      top: 10px;
      right: 12px;
    }

    .graph-warning {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      padding: 4px 8px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: rgba(4, 5, 7, 0.92);
      color: var(--yellow);
      font-size: var(--fs-xs);
      z-index: 6;
      white-space: nowrap;
      pointer-events: none;
    }

    .live-values {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-faint);
      font-size: var(--fs-2xs);
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .legend-line {
      width: 14px;
      height: 2px;
      border-radius: 1px;
      background: var(--line-strong);
    }

    .legend-line.high { background: var(--accent); }
    .legend-line.low { background: var(--line-strong); }

    .graph-controls {
      position: absolute;
      right: 12px;
      bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      z-index: 5;
    }

    .graph-control {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: rgba(6, 7, 9, 0.92);
      color: var(--text-faint);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: color 0.14s ease, border-color 0.14s ease;
    }

    .graph-control:hover {
      border-color: var(--line-strong);
      color: var(--text);
    }

    /* SVG Nodes & Edges */
    .graph-node {
      cursor: pointer;
      outline: none;
    }

    .node-card {
      fill: var(--panel-2);
      stroke: var(--line-strong);
      stroke-width: 1;
      transition: fill 0.14s ease, stroke 0.14s ease;
    }

    .graph-node:hover .node-card,
    .graph-node.is-active .node-card {
      fill: var(--panel-3);
      stroke: var(--accent);
    }

    .graph-node.is-connected .node-card {
      stroke: rgba(155, 140, 232, 0.55);
    }

    .node-accent {
      fill: var(--line-strong);
    }

    .graph-node.kind-input .node-accent {
      fill: var(--accent);
    }

    .graph-node.kind-operation .node-accent {
      fill: var(--violet);
    }

    .graph-node.kind-constant .node-accent {
      fill: var(--line-strong);
    }

    .graph-node.kind-state .node-accent {
      fill: var(--orange);
    }

    .graph-node.kind-output .node-accent {
      fill: var(--green);
    }

    .node-op-glyph {
      fill: var(--text-dim);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 600;
      dominant-baseline: alphabetic;
      pointer-events: none;
    }

    .node-label {
      fill: var(--text);
      font-family: var(--font-mono);
      font-size: 12px;
      font-weight: 600;
      dominant-baseline: alphabetic;
      pointer-events: none;
    }

    .node-sub {
      fill: var(--text-faint);
      font-family: var(--font-mono);
      font-size: 9.5px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      dominant-baseline: alphabetic;
      pointer-events: none;
    }

    .node-value {
      fill: var(--accent);
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      dominant-baseline: alphabetic;
      pointer-events: none;
    }

    .graph-node.value-low .node-value,
    .graph-node.value-unknown .node-value {
      fill: var(--text-faint);
    }

    .node-width {
      fill: var(--text-faint);
      font-family: var(--font-mono);
      font-size: 9.5px;
      dominant-baseline: alphabetic;
      pointer-events: none;
    }

    .graph-edge path {
      fill: none;
      stroke: var(--line-strong);
      stroke-width: 1.2px;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .graph-edge.high path {
      stroke: rgba(108, 158, 255, 0.55);
      stroke-width: 1.3px;
    }

    .graph-edge.low path {
      stroke: rgba(110, 128, 168, 0.32);
      stroke-width: 1.2px;
    }

    .graph-edge.is-active path {
      stroke: var(--violet);
      stroke-width: 2.2px;
      filter: drop-shadow(0 0 4px rgba(155, 140, 232, 0.6));
    }

    .graph-edge.unknown path {
      stroke: rgba(110, 128, 168, 0.25);
      stroke-width: 1.2px;
    }

    .edge-width rect {
      fill: var(--panel-2);
      stroke: var(--line-strong);
      stroke-width: 1;
    }

    .edge-width.is-muted rect,
    .edge-width.is-muted text {
      opacity: 0.35;
    }

    .edge-width text {
      fill: var(--text-faint);
      font-family: var(--font-mono);
      font-size: 9px;
      dominant-baseline: central;
      pointer-events: none;
    }

    /* Batched nodes (extreme zoom out) - Match Web CircuitGraph */
    .graph-node-batch path {
      fill: var(--text-faint);
      stroke: none;
    }
    .graph-node-batch.kind-input path { fill: var(--accent); }
    .graph-node-batch.kind-operation path { fill: var(--violet); }
    .graph-node-batch.kind-constant path { fill: var(--text-faint); }
    .graph-node-batch.kind-state path { fill: var(--orange); }
    .graph-node-batch.kind-output path { fill: var(--text-dim); }

    /* Graph Inspector */
    .graph-inspector {
      position: absolute;
      right: 12px;
      bottom: 48px;
      width: 236px;
      padding: 10px 12px;
      border: 1px solid var(--line-strong);
      border-radius: var(--radius);
      background: rgba(10, 12, 15, 0.96);
      box-shadow: 0 14px 36px rgba(0, 2, 6, 0.62);
      z-index: 10;
    }

    .graph-inspector-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 7px;
      margin-bottom: 7px;
    }

    .graph-inspector-head .eyebrow {
      display: block;
      font-size: 10px;
      color: var(--text-faint);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .graph-inspector-head h3 {
      font-size: 13px;
      font-family: var(--font-mono);
      color: var(--text);
      font-weight: 600;
    }

    .graph-inspector-head .icon-button {
      background: transparent;
      border: 0;
      color: var(--text-faint);
      cursor: pointer;
      font-size: 12px;
      padding: 2px 4px;
    }

    .graph-inspector-head .icon-button:hover {
      color: var(--text);
    }

    .graph-inspector-value {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 0;
      border-top: 1px solid var(--line);
      color: var(--text-dim);
      font-size: var(--fs-xs);
    }

    .insp-dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 10px;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--line);
      font-size: var(--fs-xs);
    }

    .insp-dl dt {
      color: var(--text-faint);
    }

    .insp-dl dd {
      color: var(--text);
      text-align: right;
      margin: 0;
      font-family: var(--font-mono);
    }

    /* ---------------- Truth Table ---------------- */
    .table-container {
      padding: 16px;
      overflow: auto;
      height: 100%;
    }

    .truth-table {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      border-collapse: collapse;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      overflow: hidden;
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
    }

    .truth-table th, .truth-table td {
      padding: 7px 12px;
      text-align: center;
      border: 1px solid var(--line);
    }

    .truth-table th {
      background: var(--panel-2);
      color: var(--text);
      font-weight: 600;
    }

    .truth-table tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.015);
    }

    .truth-table tr.active-row {
      background: var(--accent-soft);
      font-weight: bold;
    }

    /* ---------------- Waveform ---------------- */
    .waveform-view {
      padding: 16px;
      height: 100%;
      overflow-y: auto;
    }

    .wave-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
    }

    .wave-label {
      width: 90px;
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      color: var(--text);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .wave-canvas-wrap {
      flex: 1;
      height: 24px;
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: 3px;
      overflow: hidden;
    }

    .wave-svg {
      width: 100%;
      height: 100%;
      display: block;
    }

    /* ---------------- Tests View ---------------- */
    .tests-view {
      padding: 16px;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
      height: 100%;
      overflow-y: auto;
    }

    .test-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 10px 14px;
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      font-size: var(--fs-xs);
    }

    .test-suite-card {
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      margin-bottom: 12px;
      overflow: hidden;
    }

    .suite-header {
      padding: 8px 12px;
      background: var(--panel-3);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      font-size: var(--fs-xs);
    }

    .case-item {
      padding: 6px 12px;
      border-top: 1px solid var(--line);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: var(--fs-xs);
    }

    .badge-pass {
      color: var(--green);
      background: rgba(108, 196, 143, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
    }

    .badge-fail {
      color: var(--red);
      background: rgba(232, 120, 120, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
    }

    .badge-warn {
      color: var(--yellow);
      background: rgba(220, 184, 98, 0.15);
      padding: 2px 6px;
      border-radius: 3px;
      font-weight: bold;
    }

    .truth-reason {
      margin-bottom: 12px;
      padding: 8px 12px;
      background: rgba(220, 184, 98, 0.08);
      border: 1px solid rgba(220, 184, 98, 0.25);
      border-radius: var(--radius);
      color: var(--yellow);
      font-size: var(--fs-xs);
    }

    .case-error {
      color: var(--red);
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
    }

    .test-rows {
      border-top: 1px solid var(--line);
      padding: 4px 12px 8px;
      background: rgba(0, 0, 0, 0.12);
    }

    .test-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 2px 0;
      font-family: var(--font-mono);
      font-size: var(--fs-2xs);
      color: var(--text-dim);
    }

    .row-kind {
      min-width: 46px;
      color: var(--text-faint);
      font-size: var(--fs-2xs);
      letter-spacing: 0.04em;
    }

    .row-name {
      flex: 1;
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .row-value {
      color: var(--accent);
    }

    .expect-row.pass .row-value {
      color: var(--green);
    }

    .expect-row.fail .row-value {
      color: var(--red);
    }

    .expect-row.fail .row-value.actual {
      color: var(--red);
      text-decoration: underline;
      text-decoration-style: wavy;
      text-underline-offset: 2px;
    }

    .expect-values {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .arrow {
      color: var(--text-faint);
    }

    .row-result {
      width: 14px;
      text-align: center;
      font-weight: bold;
    }

    .expect-row.pass .row-result {
      color: var(--green);
    }

    .expect-row.fail .row-result {
      color: var(--red);
    }

    /* ---------------- IR View ---------------- */
    .ir-view {
      padding: 16px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .ir-pre {
      flex: 1;
      background: var(--panel-2);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 14px;
      font-family: var(--font-mono);
      font-size: var(--fs-xs);
      color: #93c5fd;
      overflow: auto;
      white-space: pre-wrap;
    }

    /* Empty state */
    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--text-faint);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }
  </style>
</head>
<body>
  <!-- Diagnostics Banner -->
  <div id="diagnostics-banner" class="diagnostics-banner">
    <span>⚠️</span>
    <span id="diagnostics-text"></span>
  </div>

  <!-- Top Bar -->
  <div class="top-bar">
    <div class="tabs">
      <button class="tab-btn active" data-tab="circuit">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h5l4 6h7M4 18h5l4-6"/><circle cx="20" cy="12" r="2"/></svg>
        Circuit
        <span class="tab-badge" id="circuit-node-count">0</span>
      </button>
      <button class="tab-btn" data-tab="truth">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/></svg>
        Truth table
        <span class="tab-badge" id="truth-row-count">0</span>
      </button>
      <button class="tab-btn" data-tab="waveform">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>
        Waveform
      </button>
      <button class="tab-btn" data-tab="tests">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31L4 19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-6-9.69V2h-4z"/></svg>
        Tests
        <span class="tab-badge" id="tests-count">0</span>
      </button>
      <button class="tab-btn" data-tab="ir">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>
        IR
      </button>
    </div>

    <div class="top-actions">
      <select id="circuit-picker" class="circuit-select"></select>
      <button id="btn-refresh" class="btn-action" title="Refresh Studio from current editor">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
        Refresh
      </button>
      <button id="btn-expand" class="btn-action" title="Open in Editor Beside">⤢ Expand</button>
      <span class="version-tag" title="Short Circuit Extension Version">v${version}</span>
    </div>
  </div>

  <!-- Content Container -->
  <div class="view-container">
    <!-- Empty / Welcome State -->
    <div id="empty-state" class="empty-state" style="display: none;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-faint);"><path d="M4 6h5l4 6h7M4 18h5l4-6"/><circle cx="20" cy="12" r="2"/></svg>
      <h3 id="empty-title">No LogicFlow file active</h3>
      <p id="empty-text">Open or focus a <code>.lf</code> file in the editor to start live circuit simulation.</p>
      <button id="btn-empty-refresh" class="btn-action" style="margin-top: 14px; align-self: center;" title="Refresh Studio">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
        Refresh Studio
      </button>
    </div>

    <!-- Circuit Tab Content -->
    <div id="tab-circuit" class="tab-content active">
      <!-- Simulator Dock (Exact Web SimulatorDock Structure) -->
      <div class="sim-dock">
        <div class="sim-dock-head">
          <div class="sim-dock-title">
            <span class="live-dot"></span>
            <span>Live simulation</span>
          </div>
          <div class="sim-dock-actions">
            <span class="sim-clock-hint" id="sim-clock-hint" style="display: none;">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              0 → 1 fires a rising edge
            </span>
            <button class="text-button compact" id="btn-reset" title="Reset all inputs and stored state">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Reset
            </button>
          </div>
        </div>

        <!-- Clock Play / Step / Speed Controls Row (Web UI port) -->
        <div id="dock-controls-row" class="dock-controls-row" style="display: none;">
          <div class="dock-controls">
            <select class="dock-select" id="clock-select" aria-label="Clock to drive"></select>
            <button class="text-button compact" id="btn-clock-step" title="Pulse the clock once: 0 to 1 to 0">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
              Step
            </button>
            <button class="text-button compact" id="btn-clock-run" title="Run the clock continuously">
              <svg id="clock-run-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              <span id="clock-run-text">Run</span>
            </button>
            <select class="dock-select" id="clock-speed" aria-label="Clock speed">
              <option value="1">1 Hz</option>
              <option value="2" selected>2 Hz</option>
              <option value="5">5 Hz</option>
              <option value="10">10 Hz</option>
            </select>
          </div>
        </div>

        <div class="sim-columns">
          <div class="sim-group inputs-group">
            <div class="sim-group-title">
              <span>Inputs</span>
              <span id="input-count-badge" class="group-count">0</span>
            </div>
            <div id="inputs-list" class="io-list"></div>
          </div>
          <div id="col-resizer" class="pane-resizer vertical" role="separator" tabindex="0" aria-label="Resize input and output columns" title="Resize input and output columns. Drag or double click to reset."></div>
          <div class="sim-group outputs-group">
            <div class="sim-group-title">
              <span>Outputs</span>
              <span id="output-count-badge" class="group-count">0</span>
            </div>
            <div id="outputs-list" class="monitor-list"></div>
          </div>
        </div>
      </div>

      <!-- Dock Resizer (Horizontal) -->
      <div id="dock-resizer" class="pane-resizer horizontal" role="separator" tabindex="0" aria-label="Resize simulation panel and graph" title="Resize simulation panel and graph. Drag or double click to reset."></div>

      <!-- Evaluation Graph Toolbar (Matches Web UI) -->
      <div class="graph-toolbar">
        <div class="graph-toolbar-title">
          <div>
            Evaluation graph <strong id="graph-circuit-name">—</strong> <span id="graph-meta">—</span>
          </div>
          <span id="graph-mode-badge" class="graph-mode">Combinational</span>
        </div>
      </div>

      <!-- Evaluation Graph Stage (SVG-native, matches Web CircuitGraph) -->
      <div id="graph-stage" class="graph-stage">
        <div class="graph-overlay graph-legend">
          <span class="live-values">
            <span class="live-dot"></span> LIVE VALUES
          </span>
          <span class="legend-item"><i class="legend-line high"></i> HIGH</span>
          <span class="legend-item"><i class="legend-line low"></i> LOW</span>
        </div>

        <div id="graph-warning" class="graph-warning" style="display: none;">
          Large graph · use zoom or inspect a subcircuit
        </div>

        <div class="graph-overlay graph-layers">
          <span id="graph-nodes-count">0 nodes</span>
          <span id="graph-layers-count">0 layers</span>
        </div>

        <svg id="circuit-graph" class="circuit-graph" role="img" aria-label="Circuit Graph">
          <g id="graph-world">
            <g id="graph-edges" class="graph-edges"></g>
            <g id="graph-widths" class="graph-widths"></g>
            <g id="graph-nodes" class="graph-nodes"></g>
          </g>
        </svg>

        <div class="graph-controls">
          <button class="graph-control" id="btn-zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
          <button class="graph-control" id="btn-zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
          <button class="graph-control" id="btn-zoom-fit" aria-label="Fit graph" title="Fit graph">⤢</button>
        </div>

        <aside id="graph-inspector" class="graph-inspector" style="display: none;">
          <div class="graph-inspector-head">
            <div>
              <span class="eyebrow" id="insp-title">NODE</span>
              <h3 id="insp-label">—</h3>
            </div>
            <button class="icon-button" id="btn-close-insp" aria-label="Close">✕</button>
          </div>
          <div class="graph-inspector-value">
            <span class="mono" id="insp-val">—</span>
            <span id="insp-bits">—</span>
          </div>
          <dl class="insp-dl">
            <div>
              <dt>Decimal</dt>
              <dd id="insp-dec">—</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd id="insp-kind">—</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd id="insp-scope">—</dd>
            </div>
            <div>
              <dt>Defined</dt>
              <dd id="insp-line">—</dd>
            </div>
          </dl>
        </aside>
      </div>
    </div>

    <!-- Truth Table Tab Content -->
    <div id="tab-truth" class="tab-content">
      <div class="table-container">
        <div id="truth-table-view"></div>
      </div>
    </div>

    <!-- Waveform Tab Content -->
    <div id="tab-waveform" class="tab-content">
      <div class="waveform-view">
        <div id="waveform-chart" class="waveform-chart"></div>
      </div>
    </div>

    <!-- Tests Tab Content -->
    <div id="tab-tests" class="tab-content">
      <div class="tests-view">
        <div id="tests-summary" class="test-summary"></div>
        <div id="tests-list"></div>
      </div>
    </div>

    <!-- IR Tab Content -->
    <div id="tab-ir" class="tab-content">
      <div class="ir-view">
        <pre id="ir-pre" class="ir-pre"></pre>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const persistedState = (() => {
      try { return vscode.getState() || {}; } catch (_) { return {}; }
    })();
    const initialTab = ${initialTabJson};
    const validTabs = ["circuit", "truth", "waveform", "tests", "ir"];
    let model = ${modelJson};
    let activeTab = validTabs.indexOf(persistedState.activeTab) >= 0 ? persistedState.activeTab : initialTab;
    let selectedNodeId = null;
    let hoveredNodeId = null;

    // Clock runner state
    let clockRunning = false;
    let clockInterval = null;
    let clockSpeed = 2;
    let selectedClock = null;

    // Rendering state and lookup tables. These let a simulation tick patch
    // values instead of rebuilding the whole DOM.
    let activeCircuitData = null;
    let fullNodesById = new Map();
    let layoutNodeById = new Map();
    let graphNodeEls = new Map();
    let graphEdgeEls = [];
    let graphEdgesByNode = new Map();
    let activeNodeEl = null;
    let activeEdgeEls = [];
    let inputRowEls = new Map();
    let outputRowEls = new Map();
    let stateRowEls = new Map();
    let truthRowEls = new Map();
    let activeTruthRowEl = null;
    let requested = {};
    const outputDisplayModes = Object.assign({}, persistedState.outputDisplayModes || {});
    let dockHeight = Number(persistedState.dockHeight) || 220;
    let simSplit = Number(persistedState.simSplit) || 50;
    document.documentElement.style.setProperty("--sim-dock-height", dockHeight + "px");
    document.documentElement.style.setProperty("--sim-split", simSplit + "%");

    // Elements
    const emptyState = document.getElementById("empty-state");
    const emptyTitle = document.getElementById("empty-title");
    const emptyText = document.getElementById("empty-text");
    const circuitPicker = document.getElementById("circuit-picker");
    const circuitNodeCount = document.getElementById("circuit-node-count");
    const truthRowCount = document.getElementById("truth-row-count");
    const testsCount = document.getElementById("tests-count");
    const btnReset = document.getElementById("btn-reset");
    const btnRefresh = document.getElementById("btn-refresh");
    const btnEmptyRefresh = document.getElementById("btn-empty-refresh");
    const btnExpand = document.getElementById("btn-expand");
    const inputsList = document.getElementById("inputs-list");
    const outputsList = document.getElementById("outputs-list");
    const inputCountBadge = document.getElementById("input-count-badge");
    const outputCountBadge = document.getElementById("output-count-badge");
    const diagBanner = document.getElementById("diagnostics-banner");
    const diagText = document.getElementById("diagnostics-text");
    const dockControlsRow = document.getElementById("dock-controls-row");
    const clockSelect = document.getElementById("clock-select");
    const btnClockStep = document.getElementById("btn-clock-step");
    const btnClockRun = document.getElementById("btn-clock-run");
    const clockRunIcon = document.getElementById("clock-run-icon");
    const clockRunText = document.getElementById("clock-run-text");
    const clockSpeedSelect = document.getElementById("clock-speed");
    const simClockHint = document.getElementById("sim-clock-hint");
    const graphCircuitName = document.getElementById("graph-circuit-name");
    const graphMeta = document.getElementById("graph-meta");
    const graphModeBadge = document.getElementById("graph-mode-badge");
    const graphWarning = document.getElementById("graph-warning");
    const graphStage = document.getElementById("graph-stage");
    const circuitGraphSvg = document.getElementById("circuit-graph");
    const graphWorld = document.getElementById("graph-world");
    const graphEdgesLayer = document.getElementById("graph-edges");
    const graphWidthsLayer = document.getElementById("graph-widths");
    const graphNodesLayer = document.getElementById("graph-nodes");
    const graphNodesCount = document.getElementById("graph-nodes-count");
    const graphLayersCount = document.getElementById("graph-layers-count");
    const graphInspector = document.getElementById("graph-inspector");
    const truthTableView = document.getElementById("truth-table-view");
    const waveformChart = document.getElementById("waveform-chart");
    const testsSummary = document.getElementById("tests-summary");
    const testsList = document.getElementById("tests-list");
    const irPre = document.getElementById("ir-pre");

    // Utilities
    function escapeHtml(str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function compactValue(binary, width) {
      if (binary === undefined || binary === null) return "?";
      const s = String(binary);
      if (s.length <= 10) return s;
      if (s.length <= 64 && width && width % 4 === 0) {
        try {
          const hex = BigInt("0b" + s).toString(16).toUpperCase();
          return "0x" + hex.padStart(width / 4, "0");
        } catch (_) {
          return s.slice(0, 6) + "…";
        }
      }
      return s.slice(0, 8) + "…";
    }

    function decimalValue(binary) {
      if (!binary) return "—";
      try {
        return BigInt("0b" + String(binary).replace(/[^01]/g, "")).toString(10);
      } catch (_) {
        return "—";
      }
    }

    function isHighValue(value) {
      return typeof value === "string" && value.indexOf("1") >= 0;
    }

    function inputValue(name, width) {
      let value = model && model.inputs ? (model.inputs[name] || "0") : "0";
      if (width > 1) value = value.padStart(width, "0");
      return value;
    }

    function outputValue(name, width) {
      const signal = model && model.snapshot && model.snapshot.outputs ? model.snapshot.outputs[name] : null;
      let value = signal ? signal.binary : "0";
      if (width > 1) value = value.padStart(width, "0");
      return value;
    }

    function nodeValue(node) {
      if (!model) return undefined;
      if (node.kind === "output") return outputValue(node.label, node.width);
      if (node.kind === "input") return inputValue(node.label, node.width);
      return model.snapshot && model.snapshot.nodes ? model.snapshot.nodes[node.id] : undefined;
    }

    function persistState() {
      try {
        vscode.setState(Object.assign({}, vscode.getState() || {}, {
          activeTab: activeTab,
          outputDisplayModes: outputDisplayModes,
          dockHeight: dockHeight,
          simSplit: simSplit
        }));
      } catch (_) {}
    }

    function syncTabButtons() {
      document.querySelectorAll(".tab-btn").forEach(function (button) {
        button.classList.toggle("active", button.getAttribute("data-tab") === activeTab);
      });
      document.querySelectorAll(".tab-content").forEach(function (content) {
        content.classList.toggle("active", content.id === "tab-" + activeTab);
      });
    }

    function setActiveTab(tab, options) {
      if (validTabs.indexOf(tab) < 0) return;
      activeTab = tab;
      syncTabButtons();
      persistState();
      ensureTabData();
      if (tab === "circuit") setTimeout(fitGraphIfNeeded, 40);
      if (options && options.focusPicker) circuitPicker.focus();
    }

    document.querySelectorAll(".tab-btn").forEach(function (button) {
      button.addEventListener("click", function () {
        setActiveTab(button.getAttribute("data-tab"));
      });
    });

    function ensureTabData() {
      if (!model || !model.circuits || model.circuits.length === 0) return;
      if (activeTab === "truth" && !model.truthTable) requestData("truthTable");
      if (activeTab === "waveform" && !model.waveform) requestData("waveform");
      if (activeTab === "ir" && (model.irText === null || model.irText === undefined)) requestData("irText");
    }

    function requestData(kind) {
      if (requested[kind]) return;
      requested[kind] = true;
      vscode.postMessage({ type: "requestData", kind: kind });
      if (kind === "truthTable") renderTruthTable();
      if (kind === "waveform") renderWaveform();
      if (kind === "irText") renderIr();
    }

    // Circuit picker change
    circuitPicker.addEventListener("change", function (event) {
      stopClock();
      vscode.postMessage({ type: "selectCircuit", name: event.target.value });
    });

    // Reset button
    btnReset.addEventListener("click", function () {
      stopClock();
      vscode.postMessage({ type: "resetInputs" });
    });

    // Expand button
    btnExpand.addEventListener("click", function () {
      vscode.postMessage({ type: "expand" });
    });

    // Refresh buttons
    btnRefresh.addEventListener("click", function () {
      btnRefresh.classList.add("is-refreshing");
      setTimeout(function () { btnRefresh.classList.remove("is-refreshing"); }, 600);
      vscode.postMessage({ type: "refresh" });
    });
    btnEmptyRefresh.addEventListener("click", function () {
      btnEmptyRefresh.classList.add("is-refreshing");
      setTimeout(function () { btnEmptyRefresh.classList.remove("is-refreshing"); }, 600);
      vscode.postMessage({ type: "refresh" });
    });

    // Clock step and run
    btnClockStep.addEventListener("click", function () {
      if (selectedClock) vscode.postMessage({ type: "stepClock", clock: selectedClock });
    });

    btnClockRun.addEventListener("click", function () {
      if (clockRunning) stopClock();
      else startClock();
    });

    clockSelect.addEventListener("change", function (event) {
      selectedClock = event.target.value;
      if (clockRunning) {
        startClock();
      }
    });

    clockSpeedSelect.addEventListener("change", function (event) {
      clockSpeed = Number(event.target.value) || 2;
      vscode.postMessage({ type: "setClockSpeed", speed: clockSpeed });
    });

    function startClock() {
      if (!selectedClock) selectedClock = clockSelect.value;
      if (!selectedClock) return;
      clockRunning = true;
      btnClockRun.classList.add("is-active");
      clockRunText.textContent = "Pause";
      clockRunIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      vscode.postMessage({ type: "startClock", clock: selectedClock, speed: clockSpeed });
    }

    function stopClock() {
      clockRunning = false;
      btnClockRun.classList.remove("is-active");
      clockRunText.textContent = "Run";
      clockRunIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      vscode.postMessage({ type: "stopClock" });
    }

    // ---- Pane Resizers (Simulator Dock height & Column split) ----
    const dockResizer = document.getElementById("dock-resizer");
    const colResizer = document.getElementById("col-resizer");
    const simDock = document.querySelector(".sim-dock");
    const simColumns = document.querySelector(".sim-columns");
    const tabCircuit = document.getElementById("tab-circuit");

    let dockDrag = null;
    let colDrag = null;

    if (dockResizer && simDock && tabCircuit) {
      dockResizer.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        dockDrag = {
          startY: event.clientY,
          startHeight: simDock.getBoundingClientRect().height,
        };
        document.body.classList.add("is-resizing-rows");
        try { dockResizer.setPointerCapture(event.pointerId); } catch (_) {}
      });

      dockResizer.addEventListener("pointermove", function (event) {
        if (!dockDrag) return;
        const dy = event.clientY - dockDrag.startY;
        const totalHeight = tabCircuit.clientHeight || 600;
        const minH = 80;
        const maxH = Math.max(minH, totalHeight - 120);
        const nextH = Math.max(minH, Math.min(maxH, dockDrag.startHeight + dy));
        dockHeight = Math.round(nextH);
        document.documentElement.style.setProperty("--sim-dock-height", dockHeight + "px");
      });

      function stopDockDrag(event) {
        if (!dockDrag) return;
        dockDrag = null;
        document.body.classList.remove("is-resizing-rows");
        try {
          if (dockResizer.hasPointerCapture && dockResizer.hasPointerCapture(event.pointerId)) {
            dockResizer.releasePointerCapture(event.pointerId);
          }
        } catch (_) {}
        persistState();
      }

      dockResizer.addEventListener("pointerup", stopDockDrag);
      dockResizer.addEventListener("pointercancel", stopDockDrag);
      dockResizer.addEventListener("dblclick", function () {
        dockHeight = 220;
        document.documentElement.style.setProperty("--sim-dock-height", "220px");
        persistState();
      });
      dockResizer.addEventListener("keydown", function (event) {
        if (event.key === "ArrowUp") {
          dockHeight = Math.max(80, dockHeight - 16);
          document.documentElement.style.setProperty("--sim-dock-height", dockHeight + "px");
          persistState();
        } else if (event.key === "ArrowDown") {
          dockHeight = Math.min((tabCircuit.clientHeight || 600) - 120, dockHeight + 16);
          document.documentElement.style.setProperty("--sim-dock-height", dockHeight + "px");
          persistState();
        }
      });
    }

    if (colResizer && simColumns) {
      colResizer.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) return;
        const rect = simColumns.getBoundingClientRect();
        colDrag = {
          startX: event.clientX,
          containerWidth: rect.width || 400,
          startPercent: simSplit,
        };
        document.body.classList.add("is-resizing-columns");
        try { colResizer.setPointerCapture(event.pointerId); } catch (_) {}
      });

      colResizer.addEventListener("pointermove", function (event) {
        if (!colDrag) return;
        const dx = event.clientX - colDrag.startX;
        const deltaPercent = (dx / (colDrag.containerWidth || 400)) * 100;
        const nextPercent = Math.max(18, Math.min(82, colDrag.startPercent + deltaPercent));
        simSplit = Math.round(nextPercent);
        document.documentElement.style.setProperty("--sim-split", simSplit + "%");
      });

      function stopColDrag(event) {
        if (!colDrag) return;
        colDrag = null;
        document.body.classList.remove("is-resizing-columns");
        try {
          if (colResizer.hasPointerCapture && colResizer.hasPointerCapture(event.pointerId)) {
            colResizer.releasePointerCapture(event.pointerId);
          }
        } catch (_) {}
        persistState();
      }

      colResizer.addEventListener("pointerup", stopColDrag);
      colResizer.addEventListener("pointercancel", stopColDrag);
      colResizer.addEventListener("dblclick", function () {
        simSplit = 50;
        document.documentElement.style.setProperty("--sim-split", "50%");
        persistState();
      });
      colResizer.addEventListener("keydown", function (event) {
        if (event.key === "ArrowLeft") {
          simSplit = Math.max(18, simSplit - 4);
          document.documentElement.style.setProperty("--sim-split", simSplit + "%");
          persistState();
        } else if (event.key === "ArrowRight") {
          simSplit = Math.min(82, simSplit + 4);
          document.documentElement.style.setProperty("--sim-split", simSplit + "%");
          persistState();
        }
      });
    }

    // ---- Zoom / Pan / View constants (match web CircuitGraph.tsx) ----
    const MIN_ZOOM = 0.01;
    const MAX_ZOOM = 2.6;
    const FIT_MIN_ZOOM = 0.62;  // Never fit below this — wide graphs are panned, not shrunk
    const FIT_MAX_ZOOM = 1.05;
    const ZOOM_BUTTON_FACTOR_IN = 1.18;
    const ZOOM_BUTTON_FACTOR_OUT = 0.85;
    const WHEEL_SENSITIVITY = 0.0012;  // exponential: exp(-deltaY * sensitivity)

    // Level-of-detail thresholds (exact match with web CircuitGraph.tsx)
    const MIN_DETAIL_SCALE = 0.5;      // Below: nodes collapse to colored blocks
    const MIN_CURVE_SCALE = 0.7;       // Below: straight lines instead of curves
    const MIN_ACCENT_SCALE = 0.2;      // Below: no kind accent bar
    const MIN_NODE_BATCH_SCALE = 0.12; // Below: batch nodes by kind into single paths
    const MIN_BADGE_SCALE = 0.7;       // Below: no width badges on edges (matches web CircuitGraph line 31!)
    const VIEW_OVERSCAN = 180;         // Extra world-space margin for culling
    const MAX_WIDTH_BADGES = 160;      // Max width badges to render

    // LOD thresholds array for checking crossings
    const LOD_THRESHOLDS = [MIN_DETAIL_SCALE, MIN_CURVE_SCALE, MIN_ACCENT_SCALE, MIN_NODE_BATCH_SCALE, MIN_BADGE_SCALE];

    function crossesLodThreshold(a, b) {
      if (a === b) return false;
      for (let index = 0; index < LOD_THRESHOLDS.length; index += 1) {
        const t = LOD_THRESHOLDS[index];
        if ((a < t && b >= t) || (a >= t && b < t)) return true;
      }
      return false;
    }

    // ---- View state ----
    let panX = 40;
    let panY = 40;
    let zoomScale = 1.0;
    let dragRef = null;
    let transformFrame = null;
    let lastRenderedLodScale = 1.0;
    let lastCullPanX = 40;
    let lastCullPanY = 40;
    let lastCullScale = 1.0;

    // Cached layout for culling/LOD
    let fullLayoutNodes = [];
    let fullLayoutEdges = [];
    let layoutNeighbors = new Map();
    let currentVisibleNodes = [];
    let currentVisibleEdges = [];

    function scheduleTransform(forceRender) {
      if (transformFrame !== null) return;
      transformFrame = requestAnimationFrame(function () {
        transformFrame = null;
        graphWorld.setAttribute("transform", "translate(" + panX + " " + panY + ") scale(" + zoomScale + ")");

        const lodChanged = crossesLodThreshold(lastRenderedLodScale, zoomScale);
        const overscanThreshold = Math.max(32, (VIEW_OVERSCAN * zoomScale) * 0.4);
        const pannedPastOverscan =
          Math.abs(panX - lastCullPanX) > overscanThreshold ||
          Math.abs(panY - lastCullPanY) > overscanThreshold ||
          Math.abs(zoomScale - lastCullScale) / lastCullScale > 0.06;

        if (forceRender || lodChanged || pannedPastOverscan) {
          lastRenderedLodScale = zoomScale;
          lastCullPanX = panX;
          lastCullPanY = panY;
          lastCullScale = zoomScale;
          renderGraph();
        }
      });
    }

    function applyTransform() {
      if (transformFrame !== null) {
        cancelAnimationFrame(transformFrame);
        transformFrame = null;
      }
      graphWorld.setAttribute("transform", "translate(" + panX + " " + panY + ") scale(" + zoomScale + ")");
    }

    function zoomBy(factor) {
      const rect = graphStage.getBoundingClientRect();
      const currentScale = zoomScale;
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentScale * factor));
      if (nextScale === currentScale) return;
      const ratio = nextScale / currentScale;
      const cx = (rect.width || 600) / 2;
      const cy = (rect.height || 400) / 2;
      panX = cx - (cx - panX) * ratio;
      panY = cy - (cy - panY) * ratio;
      zoomScale = nextScale;
      applyTransform();
      lastRenderedLodScale = zoomScale;
      lastCullPanX = panX;
      lastCullPanY = panY;
      lastCullScale = zoomScale;
      renderGraph();
    }

    document.getElementById("btn-zoom-in").addEventListener("click", function () {
      zoomBy(ZOOM_BUTTON_FACTOR_IN);
    });

    document.getElementById("btn-zoom-out").addEventListener("click", function () {
      zoomBy(ZOOM_BUTTON_FACTOR_OUT);
    });

    document.getElementById("btn-zoom-fit").addEventListener("click", function () {
      fitGraph();
    });

    circuitGraphSvg.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      if (event.target.closest && event.target.closest("[data-graph-node]")) return;
      dragRef = {
        x: event.clientX,
        y: event.clientY,
        panX: panX,
        panY: panY,
        moved: false,
      };
      graphStage.classList.add("is-dragging");
      circuitGraphSvg.classList.add("is-dragging");
      try { circuitGraphSvg.setPointerCapture(event.pointerId); } catch (_) {}
    });

    circuitGraphSvg.addEventListener("pointermove", function (event) {
      if (!dragRef) return;
      const dx = event.clientX - dragRef.x;
      const dy = event.clientY - dragRef.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) dragRef.moved = true;
      panX = dragRef.panX + dx;
      panY = dragRef.panY + dy;
      scheduleTransform();
    });

    function handlePointerUp(event) {
      if (dragRef && !dragRef.moved) selectNode(null);
      const hadMoved = dragRef && dragRef.moved;
      dragRef = null;
      graphStage.classList.remove("is-dragging");
      circuitGraphSvg.classList.remove("is-dragging");
      try {
        if (circuitGraphSvg.hasPointerCapture && circuitGraphSvg.hasPointerCapture(event.pointerId)) {
          circuitGraphSvg.releasePointerCapture(event.pointerId);
        }
      } catch (_) {}
      if (hadMoved) {
        lastCullPanX = panX;
        lastCullPanY = panY;
        lastCullScale = zoomScale;
        renderGraph();
      }
    }

    circuitGraphSvg.addEventListener("pointerup", handlePointerUp);
    circuitGraphSvg.addEventListener("pointercancel", handlePointerUp);

    graphStage.addEventListener("wheel", function (event) {
      event.preventDefault();
      const rect = graphStage.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const currentScale = zoomScale;
      // Exponential zoom matching web: factor = exp(-deltaY * sensitivity)
      const factor = Math.exp(-event.deltaY * WHEEL_SENSITIVITY);
      const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentScale * factor));
      if (nextScale === currentScale) return;
      const ratio = nextScale / currentScale;
      panX = cx - (cx - panX) * ratio;
      panY = cy - (cy - panY) * ratio;
      zoomScale = nextScale;
      scheduleTransform();
    }, { passive: false });

    // Viewport culling (port of web's cullLayout)
    function cullLayout() {
      if (!model || !model.layout) return { nodes: [], edges: [] };
      const rect = graphStage.getBoundingClientRect();
      const viewWidth = rect.width || 600;
      const viewHeight = rect.height || 400;
      if (viewWidth <= 0 || viewHeight <= 0 || zoomScale <= 0) return { nodes: [], edges: [] };

      const overscan = Math.min(VIEW_OVERSCAN / zoomScale, 480);
      const minX = -panX / zoomScale - overscan;
      const maxX = (viewWidth - panX) / zoomScale + overscan;
      const minY = -panY / zoomScale - overscan;
      const maxY = (viewHeight - panY) / zoomScale + overscan;

      const nodes = fullLayoutNodes.filter(function (node) {
        return node.x + node.w >= minX && node.x <= maxX && node.y + node.h >= minY && node.y <= maxY;
      });
      const edges = fullLayoutEdges.filter(function (edge) {
        return (edge.maxX === undefined || edge.maxX >= minX) &&
               (edge.minX === undefined || edge.minX <= maxX) &&
               (edge.maxY === undefined || edge.maxY >= minY) &&
               (edge.minY === undefined || edge.minY <= maxY);
      });

      if (nodes.length === fullLayoutNodes.length && edges.length === fullLayoutEdges.length) {
        return { nodes: fullLayoutNodes, edges: fullLayoutEdges };
      }

      return { nodes: nodes, edges: edges };
    }

    function fitGraph() {
      if (!model || !model.layout) return;
      const rect = graphStage.getBoundingClientRect();
      const viewWidth = rect.width || 600;
      const viewHeight = rect.height || 400;
      const layoutWidth = model.layout.width || 600;
      const layoutHeight = model.layout.height || 400;
      // Match web CircuitGraph: Never zoom out past the point where labels stop being readable (0.62)
      const scale = Math.max(
        0.62,
        Math.min(
          1.05,
          (viewWidth - 64) / layoutWidth,
          (viewHeight - 64) / layoutHeight
        )
      );
      zoomScale = scale;
      panX = (viewWidth - layoutWidth * scale) / 2;
      panY = (viewHeight - layoutHeight * scale) / 2;
      applyTransform();
      lastRenderedLodScale = zoomScale;
      lastCullPanX = panX;
      lastCullPanY = panY;
      lastCullScale = zoomScale;
      renderGraph();
    }

    function fitGraphIfNeeded() {
      if (model && model.layout) fitGraph();
    }

    // Node selection and inspector
    document.getElementById("btn-close-insp").addEventListener("click", function () {
      selectNode(null);
    });

    circuitGraphSvg.addEventListener("click", function (event) {
      const nodeEl = event.target.closest ? event.target.closest("[data-graph-node]") : null;
      if (nodeEl) selectNode(nodeEl.getAttribute("data-id"));
    });

    graphNodesLayer.addEventListener("mouseover", function (event) {
      const nodeEl = event.target.closest ? event.target.closest("[data-graph-node]") : null;
      if (!nodeEl) return;
      const id = nodeEl.getAttribute("data-id");
      if (hoveredNodeId === id) return;
      hoveredNodeId = id;
      updateActiveElements();
    });

    graphNodesLayer.addEventListener("mouseout", function (event) {
      const nodeEl = event.target.closest ? event.target.closest("[data-graph-node]") : null;
      if (!nodeEl) return;
      if (event.relatedTarget && nodeEl.contains(event.relatedTarget)) return;
      hoveredNodeId = null;
      updateActiveElements();
    });

    function selectNode(id) {
      selectedNodeId = id;
      if (!id || !model || !model.layout) {
        graphInspector.style.display = "none";
        updateActiveElements();
        return;
      }

      const node = layoutNodeById.get(id);
      if (!node) {
        graphInspector.style.display = "none";
        updateActiveElements();
        return;
      }

      updateInspector(node);
      graphInspector.style.display = "block";
      updateActiveElements();
    }

    function updateInspector(node) {
      if (!node) return;
      const value = nodeValue(node);
      document.getElementById("insp-title").textContent = node.title || (node.kind.toUpperCase() + " COMPONENT");
      document.getElementById("insp-label").textContent = node.label;
      document.getElementById("insp-val").textContent = compactValue(value, node.width);
      document.getElementById("insp-bits").textContent = node.width + " bit" + (node.width === 1 ? "" : "s");
      document.getElementById("insp-dec").textContent = decimalValue(value);
      document.getElementById("insp-kind").textContent = node.kind === "output" ? (node.sourceId ? node.sourceId.split("/").pop() : "output") : (node.kind === "operation" ? (node.op || "operation") : node.kind);
      document.getElementById("insp-scope").textContent = node.scope && node.scope.length ? node.scope.join(".") : "top level";
      document.getElementById("insp-line").textContent = "line " + (node.line || 1);
    }

    function updateActiveElements() {
      if (activeNodeEl) activeNodeEl.classList.remove("is-active");
      activeNodeEl = null;

      const activeId = selectedNodeId || hoveredNodeId;
      if (!activeId) {
        const pathActive = document.getElementById("edge-path-active");
        if (pathActive) pathActive.setAttribute("d", "");
        return;
      }

      const nodeEl = graphNodeEls.get(activeId);
      if (nodeEl) {
        nodeEl.classList.add("is-active");
        activeNodeEl = nodeEl;
      }

      const curved = zoomScale >= MIN_CURVE_SCALE;
      const edges = currentVisibleEdges.length > 0 ? currentVisibleEdges : (fullLayoutEdges || []);
      let activeEdgePath = "";
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        if (edge.from !== activeId && edge.to !== activeId) continue;
        const segment = curved ? edge.path : edge.straightPath;
        activeEdgePath = activeEdgePath ? activeEdgePath + " " + segment : segment;
      }
      const pathActive = document.getElementById("edge-path-active");
      if (pathActive) pathActive.setAttribute("d", activeEdgePath);
    }

    function render(newModel, forceReset) {
      const previousCircuit = model ? model.activeCircuit : null;
      const circuitChanged = previousCircuit !== (newModel ? newModel.activeCircuit : null);
      model = newModel;
      requested = {};

      if (model && model.layout) {
        fullLayoutNodes = model.layout.nodes || [];
        fullLayoutEdges = model.layout.edges || [];
        fullNodesById = new Map();
        fullLayoutNodes.forEach(function (n) { fullNodesById.set(n.id, n); });
        layoutNeighbors = new Map();
        if (model.layout.neighbors) {
          Object.keys(model.layout.neighbors).forEach(function (key) {
            layoutNeighbors.set(key, new Set(model.layout.neighbors[key]));
          });
        }
      } else {
        fullLayoutNodes = [];
        fullLayoutEdges = [];
        fullNodesById = new Map();
        layoutNeighbors = new Map();
      }

      if (circuitChanged || forceReset) {
        lastCullPanX = 40;
        lastCullPanY = 40;
        lastCullScale = 1.0;
        selectNode(null);
      }

      if (!model) {
        showEmpty("No LogicFlow file active", "Open or focus a .lf file in the editor to start live circuit simulation.");
        resetViews();
        return;
      }

      renderDiagnostics();

      if (!model.circuits || model.circuits.length === 0) {
        const hasError = (model.diagnostics || []).some(function (diagnostic) { return diagnostic.severity === "error"; });
        showEmpty(
          hasError ? "Could not compile this file" : "No circuits in this file",
          hasError ? "Fix the highlighted error to resume live simulation." : "Add a CIRCUIT block to start simulating."
        );
        resetViews();
        return;
      }

      emptyState.style.display = "none";
      document.querySelectorAll(".tab-content").forEach(function (content) { content.style.display = ""; });
      syncTabButtons();

      syncCircuitPicker();

      const activeCircuit = model.circuits.find(function (circuit) { return circuit.name === model.activeCircuit; }) || model.circuits[0];
      if (!activeCircuit) return;
      activeCircuitData = activeCircuit;

      circuitNodeCount.textContent = activeCircuit.stats.nodes;
      graphNodesCount.textContent = activeCircuit.stats.nodes + " nodes";
      graphLayersCount.textContent = (model.layout ? model.layout.depth : 0) + " layers";
      graphCircuitName.textContent = activeCircuit.name;
      graphMeta.textContent = activeCircuit.stats.nodes + " nodes • " + activeCircuit.stats.maxDepth + " deep • " + (activeCircuit.stats.maxWidth || 1) + "b max width";
      graphModeBadge.textContent = activeCircuit.sequential ? "Sequential" : "Combinational";
      graphModeBadge.classList.toggle("sequential", activeCircuit.sequential);
      graphWarning.style.display = activeCircuit.stats.nodes > 90 ? "block" : "none";

      renderClockControls(activeCircuit);
      if (previousCircuit !== activeCircuit.name) stopClock();

      renderInputs(activeCircuit);
      renderOutputs(activeCircuit);
      renderGraph();
      renderTruthTable();
      renderWaveform();
      renderTests();
      renderIr();

      ensureTabData();

      if (previousCircuit !== activeCircuit.name || forceReset) {
        setTimeout(fitGraph, 40);
      }
    }

    function showEmpty(title, text) {
      emptyTitle.textContent = title;
      emptyText.textContent = text;
      emptyState.style.display = "flex";
      circuitPicker.style.display = "none";
      document.querySelectorAll(".tab-content").forEach(function (content) {
        content.classList.remove("active");
        content.style.display = "none";
      });
    }

    function renderDiagnostics() {
      const diagnostics = model && model.diagnostics ? model.diagnostics : [];
      if (diagnostics.length === 0) {
        diagBanner.style.display = "none";
        diagText.textContent = "";
        diagText.title = "";
        return;
      }
      const first = diagnostics.find(function (diagnostic) { return diagnostic.severity === "error"; }) || diagnostics[0];
      diagBanner.style.display = "flex";
      diagText.textContent = "Line " + first.line + ": " + first.message;
      diagText.title = diagnostics.map(function (diagnostic) {
        return "Line " + diagnostic.line + ": " + diagnostic.message;
      }).join("\\n");
    }

    function resetViews() {
      requested = {};
      stopClock();
      selectNode(null);
      activeCircuitData = null;
      layoutNodeById = new Map();
      graphNodeEls = new Map();
      graphEdgesByNode = new Map();
      graphEdgeEls = [];
      fullLayoutNodes = [];
      fullLayoutEdges = [];
      fullNodesById = new Map();
      layoutNeighbors = new Map();
      lastCullPanX = 40;
      lastCullPanY = 40;
      lastCullScale = 1.0;
      inputRowEls = new Map();
      outputRowEls = new Map();
      stateRowEls = new Map();
      truthRowEls = new Map();
      activeTruthRowEl = null;
      inputsList.innerHTML = "";
      outputsList.innerHTML = "";
      graphEdgesLayer.innerHTML = "";
      graphWidthsLayer.innerHTML = "";
      graphNodesLayer.innerHTML = "";
      truthTableView.innerHTML = "";
      waveformChart.innerHTML = "";
      testsList.innerHTML = "";
      testsSummary.innerHTML = "";
      irPre.textContent = "";
      circuitPicker.innerHTML = "";
      circuitNodeCount.textContent = "0";
      truthRowCount.textContent = "0";
      testsCount.textContent = "0";
      inputCountBadge.textContent = "0";
      outputCountBadge.textContent = "0";
      graphNodesCount.textContent = "0 nodes";
      graphLayersCount.textContent = "0 layers";
      graphCircuitName.textContent = "—";
      graphMeta.textContent = "—";
      graphWarning.style.display = "none";
      diagBanner.style.display = "none";
    }

    function syncCircuitPicker() {
      const names = model.circuits.map(function (circuit) { return circuit.name; });
      const existing = Array.prototype.map.call(circuitPicker.options, function (option) { return option.value; });
      const same = existing.length === names.length && existing.every(function (name, index) { return name === names[index]; });
      if (!same) {
        circuitPicker.innerHTML = "";
        model.circuits.forEach(function (circuit) {
          const option = document.createElement("option");
          option.value = circuit.name;
          option.textContent = "Circuit " + circuit.name;
          circuitPicker.appendChild(option);
        });
      }
      circuitPicker.style.display = "";
      circuitPicker.value = model.activeCircuit;
    }

    function renderClockControls(activeCircuit) {
      const clockNames = [];
      const events = model.ir && Array.isArray(model.ir.events) ? model.ir.events : [];
      events.forEach(function (event) {
        if (!event) return;
        const name = event.clockName || event.clock;
        if (name && clockNames.indexOf(name) < 0) clockNames.push(name);
      });

      if (clockNames.length === 0) {
        dockControlsRow.style.display = "none";
        simClockHint.style.display = "none";
        stopClock();
        selectedClock = null;
        return;
      }

      dockControlsRow.style.display = "flex";
      simClockHint.style.display = "inline-flex";

      const existing = Array.prototype.map.call(clockSelect.options, function (option) { return option.value; });
      const same = existing.length === clockNames.length && existing.every(function (name, index) { return name === clockNames[index]; });
      if (!same) {
        clockSelect.innerHTML = "";
        clockNames.forEach(function (name) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          clockSelect.appendChild(option);
        });
      }

      if (selectedClock && clockNames.indexOf(selectedClock) >= 0) {
        clockSelect.value = selectedClock;
      } else {
        selectedClock = clockNames[0];
        clockSelect.value = selectedClock;
      }
      clockSpeed = Number(clockSpeedSelect.value) || clockSpeed || 2;
    }

    const SEGMENTS = {
      "0": [true, true, true, true, true, true, false],
      "1": [false, true, true, false, false, false, false],
      "2": [true, true, false, true, true, false, true],
      "3": [true, true, true, true, false, false, true],
      "4": [false, true, true, false, false, true, true],
      "5": [true, false, true, true, false, true, true],
      "6": [true, false, true, true, true, true, true],
      "7": [true, true, true, false, false, false, false],
      "8": [true, true, true, true, true, true, true],
      "9": [true, true, true, true, false, true, true],
      "A": [true, true, true, false, true, true, true],
      "B": [false, true, true, true, true, true, true],
      "C": [true, false, true, true, true, false, false],
      "D": [false, true, true, true, true, false, true],
      "E": [true, false, true, true, true, true, true],
      "F": [true, false, true, false, true, true, true]
    };

    const SEGMENT_SHAPES = [
      "M6 3 H22 L24 5 L22 7 H6 L4 5 Z",
      "M22 7 L24 9 V19 L22 21 L20 19 V9 Z",
      "M22 21 L24 19 L24 29 L22 31 L20 29 V23 Z",
      "M6 29 H22 L24 31 L22 33 H6 L4 31 Z",
      "M4 9 L6 7 L8 9 V19 L6 21 L4 19 Z",
      "M4 3 L6 5 L8 3 V13 L6 15 L4 13 Z",
      "M6 16 H22 L24 18 L22 20 H6 L4 18 Z"
    ];

    function renderSevenSegment(binary) {
      const hexChar = (parseInt(binary.slice(-4) || "0", 2) || 0).toString(16).toUpperCase();
      const segments = SEGMENTS[hexChar] || SEGMENTS["0"];
      let paths = "";
      for (let index = 0; index < 7; index += 1) {
        const on = segments[index];
        paths += '<path d="' + SEGMENT_SHAPES[index] + '" fill="' + (on ? '#6c9eff' : 'rgba(255,255,255,0.06)') + '" ' + (on ? 'filter="drop-shadow(0 0 2px #6c9eff)"' : '') + '/>';
      }
      return '<svg class="seven-seg-svg" viewBox="0 0 28 36" width="20" height="26">' + paths + '</svg><span class="decimal-value bus-decimal">#' + hexChar + '</span>';
    }

    function renderInputs(circuit) {
      inputsList.innerHTML = "";
      inputRowEls = new Map();
      inputCountBadge.textContent = circuit.inputs.length;

      if (circuit.inputs.length === 0) {
        inputsList.innerHTML = '<div class="io-empty">This circuit has no external inputs.</div>';
        return;
      }

      const clockNames = [];
      if (model.ir && Array.isArray(model.ir.events)) {
        model.ir.events.forEach(function (event) {
          const name = event.clockName || event.clock;
          if (name && clockNames.indexOf(name) < 0) clockNames.push(name);
        });
      }

      circuit.inputs.forEach(function (input) {
        const value = inputValue(input.name, input.width);
        const isHigh = isHighValue(value);
        const isClock = clockNames.indexOf(input.name) >= 0;

        const row = document.createElement("div");
        row.className = "io-control " + (input.width === 1 ? "bit-control" : "bus-control") + (isClock ? " is-clock" : "");
        row.setAttribute("data-input-name", input.name);

        const labelRow = document.createElement("div");
        labelRow.className = "io-label-row";
        labelRow.innerHTML =
          '<span class="io-label">' +
            (isClock ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' : '') +
            escapeHtml(input.name) +
          '</span>' +
          '<span class="io-width">' + input.width + 'b</span>';

        const item = { row: row, width: input.width };

        if (input.width === 1) {
          row.appendChild(labelRow);
          const switcher = document.createElement("button");
          switcher.className = "bit-switch" + (isHigh ? " is-on" : "");
          switcher.setAttribute("aria-label", "Toggle " + input.name);
          switcher.setAttribute("aria-pressed", isHigh ? "true" : "false");
          switcher.innerHTML = '<span class="bit-switch-track"><span class="bit-switch-thumb"></span></span><span class="bit-switch-value">' + (isHigh ? "1" : "0") + '</span>';
          switcher.addEventListener("click", function () {
            vscode.postMessage({ type: "toggleInput", name: input.name });
          });
          row.appendChild(switcher);
          item.switcher = switcher;
          item.switchValue = switcher.querySelector(".bit-switch-value");
        } else if (input.width > 16) {
          row.appendChild(labelRow);
          const wideRow = document.createElement("div");
          wideRow.className = "bus-wide-row";
          const textField = document.createElement("div");
          textField.className = "bus-text-field";
          const textInput = document.createElement("input");
          textInput.className = "bus-text-input";
          textInput.value = value;
          textInput.spellcheck = false;
          textInput.title = "Type binary (e.g. 100000), hex (0x20), or decimal";
          const commit = function () {
            vscode.postMessage({ type: "setInput", name: input.name, value: textInput.value });
          };
          textInput.addEventListener("change", commit);
          textInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
              commit();
              textInput.blur();
            }
          });
          textField.appendChild(textInput);
          wideRow.appendChild(textField);
          const decimal = document.createElement("span");
          decimal.className = "decimal-value bus-decimal";
          decimal.textContent = "#" + decimalValue(value);
          decimal.title = input.name + " is " + decimalValue(value) + " in decimal";
          wideRow.appendChild(decimal);
          row.appendChild(wideRow);
          item.textInput = textInput;
          item.decimal = decimal;
        } else {
          row.appendChild(labelRow);
          const cellsRow = document.createElement("div");
          cellsRow.className = "bus-cells-row";
          const bitCells = document.createElement("div");
          bitCells.className = "bit-cells";
          bitCells.setAttribute("aria-label", input.name + " bits");
          item.cells = [];

          for (let index = 0; index < input.width; index += 1) {
            const bit = value[index] || "0";
            const bitIndex = input.width - 1 - index;
            const cell = document.createElement("button");
            cell.className = "bit-cell" + (bit === "1" ? " is-on" : "");
            cell.textContent = bit;
            cell.title = input.name + "[" + bitIndex + "] = " + bit + ". Click to flip.";
            cell.addEventListener("click", function () {
              vscode.postMessage({ type: "flipBit", name: input.name, bitIndex: bitIndex });
            });
            bitCells.appendChild(cell);
            item.cells.push({ element: cell, bitIndex: bitIndex });
          }
          cellsRow.appendChild(bitCells);
          const decimal = document.createElement("span");
          decimal.className = "decimal-value bus-decimal";
          decimal.textContent = "#" + decimalValue(value);
          decimal.title = input.name + " is " + decimalValue(value) + " in decimal";
          cellsRow.appendChild(decimal);
          row.appendChild(cellsRow);
          item.decimal = decimal;
        }

        inputsList.appendChild(row);
        inputRowEls.set(input.name, item);
      });
    }

    function updateInputValues() {
      if (!activeCircuitData) return;
      const clockNames = [];
      if (model.ir && Array.isArray(model.ir.events)) {
        model.ir.events.forEach(function (event) {
          const name = event.clockName || event.clock;
          if (name && clockNames.indexOf(name) < 0) clockNames.push(name);
        });
      }

      activeCircuitData.inputs.forEach(function (input) {
        const item = inputRowEls.get(input.name);
        if (!item) return;
        const value = inputValue(input.name, input.width);
        const isHigh = isHighValue(value);
        if (item.switcher) {
          item.switcher.classList.toggle("is-on", isHigh);
          item.switcher.setAttribute("aria-pressed", isHigh ? "true" : "false");
          if (item.switchValue) item.switchValue.textContent = isHigh ? "1" : "0";
        }
        if (item.cells) {
          for (let index = 0; index < item.cells.length; index += 1) {
            const cell = item.cells[index];
            const bit = value[index] || "0";
            cell.element.textContent = bit;
            cell.element.classList.toggle("is-on", bit === "1");
            cell.element.title = input.name + "[" + cell.bitIndex + "] = " + bit + ". Click to flip.";
          }
        }
        if (item.textInput && document.activeElement !== item.textInput) {
          item.textInput.value = value;
        }
        if (item.decimal) {
          const decimal = decimalValue(value);
          item.decimal.textContent = "#" + decimal;
          item.decimal.title = input.name + " is " + decimal + " in decimal";
        }
      });
    }

    function renderOutputs(circuit) {
      outputsList.innerHTML = "";
      outputRowEls = new Map();
      stateRowEls = new Map();
      outputCountBadge.textContent = circuit.outputs.length;

      if (circuit.outputs.length === 0) {
        outputsList.innerHTML = '<div class="io-empty">No outputs are exposed.</div>';
      } else {
        circuit.outputs.forEach(function (output) {
          const value = outputValue(output.name, output.width);
          const high = isHighValue(value);
          const row = document.createElement("div");
          row.className = "monitor-row";
          row.setAttribute("data-output-name", output.name);

          const label = document.createElement("div");
          label.className = "monitor-label";
          label.innerHTML = '<span class="monitor-led ' + (high ? "hot" : "") + '"></span><span>' + escapeHtml(output.name) + '</span><span class="io-width">' + output.width + 'b</span>';
          row.appendChild(label);

          const valueRow = document.createElement("div");
          valueRow.className = "monitor-value";
          const item = {
            row: row,
            width: output.width,
            led: label.querySelector(".monitor-led"),
            valueRow: valueRow
          };

          if (output.width === 1) {
            const pill = document.createElement("span");
            pill.className = "output-pill" + (high ? " high" : "");
            pill.textContent = high ? "1" : "0";
            pill.title = output.name + " is " + (high ? "HIGH (1)" : "LOW (0)");
            valueRow.appendChild(pill);
            item.pill = pill;
          } else {
            const requestedMode = outputDisplayModes[output.name] || "number";
            const mode = ["number", "led", "seven", "bar"].indexOf(requestedMode) >= 0 ? requestedMode : "number";
            outputDisplayModes[output.name] = mode;
            item.mode = mode;

            if (mode === "number") {
              const numberSpan = document.createElement("span");
              numberSpan.className = "display-number";
              const binary = document.createElement("span");
              binary.className = "binary-value";
              const decimal = document.createElement("span");
              decimal.className = "decimal-value";
              numberSpan.appendChild(binary);
              numberSpan.appendChild(decimal);
              valueRow.appendChild(numberSpan);
              item.binary = binary;
              item.decimal = decimal;
            } else if (mode === "led") {
              const leds = document.createElement("span");
              leds.className = "display-leds";
              item.leds = [];
              for (let index = 0; index < output.width; index += 1) {
                const led = document.createElement("span");
                leds.appendChild(led);
                item.leds.push(led);
              }
              valueRow.appendChild(leds);
            } else if (mode === "seven") {
              const seven = document.createElement("span");
              valueRow.appendChild(seven);
              item.seven = seven;
            } else {
              const barWrap = document.createElement("span");
              barWrap.style.display = "inline-flex";
              barWrap.style.alignItems = "center";
              barWrap.style.gap = "6px";
              barWrap.innerHTML = '<div class="bar-track"><div class="bar-fill"></div></div>';
              const decimal = document.createElement("span");
              decimal.className = "decimal-value";
              barWrap.appendChild(decimal);
              valueRow.appendChild(barWrap);
              item.barFill = barWrap.querySelector(".bar-fill");
              item.barDecimal = decimal;
            }

            const modeSelect = document.createElement("select");
            modeSelect.className = "display-mode-select";
            [
              { id: "number", label: "Number" },
              { id: "led", label: "LEDs" },
              { id: "seven", label: "7-segment" },
              { id: "bar", label: "Bar" }
            ].forEach(function (optionData) {
              const option = document.createElement("option");
              option.value = optionData.id;
              option.textContent = optionData.label;
              if (optionData.id === mode) option.selected = true;
              modeSelect.appendChild(option);
            });
            modeSelect.addEventListener("change", function (event) {
              outputDisplayModes[output.name] = event.target.value;
              persistState();
              renderOutputs(circuit);
            });
            valueRow.appendChild(modeSelect);
          }

          row.appendChild(valueRow);
          outputsList.appendChild(row);
          outputRowEls.set(output.name, item);
        });
      }

      if (model.ir && Array.isArray(model.ir.states) && model.ir.states.length > 0) {
        const stateBlock = document.createElement("div");
        stateBlock.className = "state-block";
        stateBlock.innerHTML = '<div class="state-title">Stored state</div>';
        model.ir.states.forEach(function (state) {
          const row = document.createElement("div");
          row.className = "monitor-row";
          row.setAttribute("data-state-name", state.name);
          row.innerHTML =
            '<div class="monitor-label">' +
              '<span class="state-glyph">S</span>' +
              '<span>' + escapeHtml(state.name) + '</span>' +
              '<span class="io-width">' + state.width + 'b</span>' +
            '</div>' +
            '<div class="monitor-value">' +
              '<span class="display-number">' +
                '<span class="binary-value"></span>' +
                (state.width > 1 ? '<span class="decimal-value"></span>' : '') +
              '</span>' +
            '</div>';
          stateBlock.appendChild(row);
          stateRowEls.set(state.name, {
            row: row,
            width: state.width,
            node: state.node,
            binary: row.querySelector(".binary-value"),
            decimal: row.querySelector(".decimal-value")
          });
        });
        outputsList.appendChild(stateBlock);
      }

      updateOutputValues();
    }

    function updateOutputValues() {
      if (!activeCircuitData) return;
      activeCircuitData.outputs.forEach(function (output) {
        const item = outputRowEls.get(output.name);
        if (!item) return;
        const value = outputValue(output.name, output.width);
        const high = isHighValue(value);
        const decimal = decimalValue(value);
        if (item.led) item.led.classList.toggle("hot", high);
        if (item.pill) {
          item.pill.classList.toggle("high", high);
          item.pill.textContent = high ? "1" : "0";
          item.pill.title = output.name + " is " + (high ? "HIGH (1)" : "LOW (0)");
        }
        if (item.binary) item.binary.textContent = value;
        if (item.decimal) item.decimal.textContent = "#" + decimal;
        if (item.leds) {
          for (let index = 0; index < item.leds.length; index += 1) {
            item.leds[index].className = "led-dot" + (value[index] === "1" ? " on" : "");
          }
        }
        if (item.seven) item.seven.innerHTML = renderSevenSegment(value);
        if (item.barFill) {
          const max = (1n << BigInt(output.width)) - 1n;
          const current = BigInt(decimal === "—" ? 0 : decimal);
          const percent = max > 0n ? Math.min(100, Math.round(Number((current * 100n) / max))) : 0;
          item.barFill.style.width = percent + "%";
          if (item.barDecimal) item.barDecimal.textContent = "#" + decimal;
        }
      });

      stateRowEls.forEach(function (item) {
        const raw = model.snapshot && model.snapshot.nodes ? model.snapshot.nodes[item.node] : undefined;
        let value = raw || "0".repeat(item.width);
        if (value.length < item.width) value = value.padStart(item.width, "0");
        if (item.binary) item.binary.textContent = value;
        if (item.decimal) item.decimal.textContent = "#" + decimalValue(value);
      });
    }

    function renderGraph() {
      if (!model || !model.layout) {
        graphEdgesLayer.innerHTML = "";
        graphWidthsLayer.innerHTML = "";
        graphNodesLayer.innerHTML = "";
        graphNodeEls = new Map();
        layoutNodeById = new Map();
        fullLayoutNodes = [];
        fullLayoutEdges = [];
        fullNodesById = new Map();
        layoutNeighbors = new Map();
        currentVisibleNodes = [];
        currentVisibleEdges = [];
        return;
      }

      const layout = model.layout;

      // Cache full layout for culling/LOD on subsequent ticks
      if (fullLayoutNodes.length === 0) {
        fullLayoutNodes = layout.nodes || [];
        fullLayoutEdges = layout.edges || [];
        fullNodesById = new Map();
        fullLayoutNodes.forEach(function (n) { fullNodesById.set(n.id, n); });
        layoutNeighbors = new Map();
        if (layout.neighbors) {
          Object.keys(layout.neighbors).forEach(function (key) {
            layoutNeighbors.set(key, new Set(layout.neighbors[key]));
          });
        }
      }

      // Viewport culling
      const culled = cullLayout();
      const visibleNodes = culled.nodes;
      const visibleEdges = culled.edges;
      currentVisibleNodes = visibleNodes;
      currentVisibleEdges = visibleEdges;

      // LOD thresholds
      const detailed = zoomScale >= MIN_DETAIL_SCALE;
      const curved = zoomScale >= MIN_CURVE_SCALE;
      const showAccent = zoomScale >= MIN_ACCENT_SCALE;
      const batchedNodes = zoomScale < MIN_NODE_BATCH_SCALE;
      const showBadges = zoomScale >= MIN_BADGE_SCALE;

      // Active node for highlighting
      const activeNodeId = selectedNodeId || hoveredNodeId;
      const activeNeighbors = activeNodeId ? (layoutNeighbors.get(activeNodeId) || new Set()) : new Set();

      // ---- Build edge batches by tone (high/low/unknown) ----
      const edgeBatches = new Map();
      visibleEdges.forEach(function (edge) {
        const fromValue = nodeValueById(edge.from);
        const tone = fromValue === undefined ? "unknown" : isHighValue(fromValue) ? "high" : "low";
        const path = curved ? edge.path : edge.straightPath;
        const existing = edgeBatches.get(tone) || "";
        edgeBatches.set(tone, existing ? existing + " " + path : path);
      });

      // Active node's edges (highlighted separately)
      let activeEdgePath = "";
      if (activeNodeId) {
        visibleEdges.forEach(function (edge) {
          if (edge.from !== activeNodeId && edge.to !== activeNodeId) return;
          const segment = curved ? edge.path : edge.straightPath;
          activeEdgePath = activeEdgePath ? activeEdgePath + " " + segment : segment;
        });
      }

      let edgesHtml =
        '<g class="graph-edge high"><path id="edge-path-high" d="' + (edgeBatches.get("high") || "") + '" vector-effect="non-scaling-stroke" shape-rendering="' + (batchedNodes ? "optimizeSpeed" : "auto") + '"></path></g>' +
        '<g class="graph-edge low"><path id="edge-path-low" d="' + (edgeBatches.get("low") || "") + '" vector-effect="non-scaling-stroke" shape-rendering="' + (batchedNodes ? "optimizeSpeed" : "auto") + '"></path></g>' +
        '<g class="graph-edge unknown"><path id="edge-path-unknown" d="' + (edgeBatches.get("unknown") || "") + '" vector-effect="non-scaling-stroke" shape-rendering="' + (batchedNodes ? "optimizeSpeed" : "auto") + '"></path></g>' +
        '<g class="graph-edge is-active"><path id="edge-path-active" d="' + activeEdgePath + '" vector-effect="non-scaling-stroke" shape-rendering="' + (batchedNodes ? "optimizeSpeed" : "auto") + '"></path></g>';
      graphEdgesLayer.innerHTML = edgesHtml;

      // ---- Width badges (only when zoomed in enough) ----
      let widthsHtml = "";
      if (showBadges) {
        const badgeEdges = visibleEdges.filter(function (edge) { return edge.width > 1; });
        if (badgeEdges.length <= MAX_WIDTH_BADGES) {
          badgeEdges.forEach(function (edge) {
            const active = activeNodeId === edge.from || activeNodeId === edge.to;
            const muted = activeNodeId !== null && !active;
            widthsHtml += '<g class="edge-width ' + (active ? "is-active" : "") + (muted ? " is-muted" : "") + '" transform="translate(' + edge.labelX + ' ' + edge.labelY + ')">' +
              '<rect x="-10" y="-8" width="20" height="13" rx="4"></rect>' +
              '<text x="0" y="2" text-anchor="middle">' + edge.width + 'b</text>' +
            '</g>';
          });
        }
      }
      graphWidthsLayer.innerHTML = widthsHtml;

      // ---- Nodes ----
      let nodesHtml = "";
      layoutNodeById = new Map();

      if (batchedNodes) {
        // Batch nodes by kind into single paths (extreme zoom out)
        const nodeBatches = new Map();
        visibleNodes.forEach(function (node) {
          const rect = "M" + node.x + " " + node.y + "h" + node.w + "v" + node.h + "h" + (-node.w) + "Z";
          const existing = nodeBatches.get(node.kind) || "";
          nodeBatches.set(node.kind, existing ? existing + " " + rect : rect);
          layoutNodeById.set(node.id, node);
        });
        nodeBatches.forEach(function (d, kind) {
          nodesHtml += '<g class="graph-node-batch kind-' + kind + '" shape-rendering="crispEdges">' +
            '<path d="' + d + '"></path>' +
          '</g>';
        });
      } else {
        // Individual nodes with full detail
        visibleNodes.forEach(function (node) {
          layoutNodeById.set(node.id, node);
          const value = nodeValue(node);
          const isHigh = isHighValue(value);
          const valueState = value === undefined ? "unknown" : (isHigh ? "high" : "low");
          const isConstant = node.kind === "constant";
          const rx = isConstant ? 9 : 11;
          const labelX = node.kind === "operation" ? 45 : 13;
          const compact = compactValue(value, node.width);
          const isActive = node.id === activeNodeId;
          const isConnected = activeNodeId !== null && activeNeighbors.has(node.id);

          let classes = "graph-node kind-" + node.kind + " value-" + valueState;
          if (isActive) classes += " is-active";
          if (isConnected) classes += " is-connected";

          nodesHtml +=
            '<g data-graph-node data-id="' + escapeHtml(node.id) + '" class="' + classes + '" transform="translate(' + node.x + ' ' + node.y + ')" tabindex="0" role="button" aria-label="' + escapeHtml(node.label) + '">' +
              '<rect class="node-card" x="0" y="0" width="' + node.w + '" height="' + node.h + '" rx="' + rx + '"></rect>' +
              (showAccent ? '<rect class="node-accent" x="0" y="12" width="3" height="' + (node.h - 24) + '" rx="2"></rect>' : '') +
              (detailed && node.kind === "operation" ? '<text class="node-op-glyph" x="13" y="21">' + escapeHtml(node.opGlyph) + '</text>' : '') +
              (detailed ? '<text class="node-label" x="' + labelX + '" y="22">' + escapeHtml(node.displayLabel) + '</text>' : '') +
              (detailed ? '<text class="node-sub" x="13" y="' + (node.h - 12) + '">' + escapeHtml(node.subLabel) + '</text>' : '') +
              (detailed ? '<text class="node-value" x="' + (node.w - 11) + '" y="22" text-anchor="end">' + escapeHtml(compact) + '</text>' : '') +
              (detailed && node.width > 1 ? '<text class="node-width" x="' + (node.w - 11) + '" y="' + (node.h - 12) + '" text-anchor="end">' + node.width + 'b</text>' : '') +
            '</g>';
        });
      }
      graphNodesLayer.innerHTML = nodesHtml;

      // Rebuild element maps for fast in-place value updates
      graphNodeEls = new Map();
      graphNodesLayer.querySelectorAll("[data-graph-node]").forEach(function (element) {
        graphNodeEls.set(element.getAttribute("data-id"), element);
      });

      lastRenderedLodScale = zoomScale;
    }

    function nodeValueById(id) {
      if (!model || !model.snapshot) return undefined;
      const node = fullNodesById.get(id) || layoutNodeById.get(id);
      if (node) return nodeValue(node);
      const dynamic = model.snapshot.nodes ? model.snapshot.nodes[id] : undefined;
      if (dynamic !== undefined) return dynamic;
      return model.inputs ? model.inputs[id] : undefined;
    }

    function updateGraphValues() {
      if (!model || !model.layout) return;

      const batchedNodes = zoomScale < MIN_NODE_BATCH_SCALE;
      if (!batchedNodes) {
        // Update node values and classes in-place
        const nodes = currentVisibleNodes.length > 0 ? currentVisibleNodes : (model.layout.nodes || []);
        for (let i = 0; i < nodes.length; i += 1) {
          const node = nodes[i];
          const element = graphNodeEls.get(node.id);
          if (!element) continue;
          const value = nodeValue(node);
          const isHigh = isHighValue(value);
          const toneClass = value === undefined ? "value-unknown" : (isHigh ? "value-high" : "value-low");
          if (!element.classList.contains(toneClass)) {
            element.classList.remove("value-high", "value-low", "value-unknown");
            element.classList.add(toneClass);
          }
          const valueLabel = element.querySelector(".node-value");
          if (valueLabel) {
            const compact = compactValue(value, node.width);
            if (valueLabel.textContent !== compact) valueLabel.textContent = compact;
          }
        }
      }

      // Fast update edge batch paths in-place — ALWAYS runs, even at extreme zoom out
      const edges = currentVisibleEdges.length > 0 ? currentVisibleEdges : (model.layout.edges || []);
      const curved = zoomScale >= MIN_CURVE_SCALE;
      const edgeBatches = new Map();
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        const fromValue = nodeValueById(edge.from);
        const tone = fromValue === undefined ? "unknown" : isHighValue(fromValue) ? "high" : "low";
        const path = curved ? edge.path : edge.straightPath;
        const existing = edgeBatches.get(tone) || "";
        edgeBatches.set(tone, existing ? existing + " " + path : path);
      }

      const pathHigh = document.getElementById("edge-path-high");
      const pathLow = document.getElementById("edge-path-low");
      const pathUnknown = document.getElementById("edge-path-unknown");
      if (pathHigh) pathHigh.setAttribute("d", edgeBatches.get("high") || "");
      if (pathLow) pathLow.setAttribute("d", edgeBatches.get("low") || "");
      if (pathUnknown) pathUnknown.setAttribute("d", edgeBatches.get("unknown") || "");
    }

    function renderTruthTable() {
      if (!model) return;
      if (!model.truthTable) {
        truthRowCount.textContent = "0";
        truthTableView.innerHTML = '<div class="empty-state">' + (requested.truthTable ? "Computing truth table…" : "Open the Truth table tab to compute it.") + '</div>';
        return;
      }

      const table = model.truthTable;
      truthRowCount.textContent = table.rows ? table.rows.length : 0;
      truthRowEls = new Map();
      activeTruthRowEl = null;

      let html = "";
      if (table.reason) {
        html += '<div class="truth-reason">' + escapeHtml(table.reason) + '</div>';
      }

      if (!table.rows || table.rows.length === 0) {
        html += '<div class="empty-state">No rows to display.</div>';
        truthTableView.innerHTML = html;
        return;
      }

      html += '<table class="truth-table"><thead><tr>';
      table.inputs.forEach(function (input) { html += '<th>' + escapeHtml(input.name) + '</th>'; });
      table.outputs.forEach(function (output) { html += '<th>' + escapeHtml(output.name) + '</th>'; });
      html += '</tr></thead><tbody>';

      table.rows.forEach(function (row) {
        html += '<tr>';
        table.inputs.forEach(function (input) { html += '<td>' + escapeHtml(row.input[input.name]) + '</td>'; });
        table.outputs.forEach(function (output) { html += '<td>' + escapeHtml(row.output[output.name]) + '</td>'; });
        html += '</tr>';
      });

      html += '</tbody></table>';
      truthTableView.innerHTML = html;

      const rowElements = truthTableView.querySelectorAll("tbody tr");
      table.rows.forEach(function (row, index) {
        const key = table.inputs.map(function (input) { return row.input[input.name] || "0"; }).join("|");
        truthRowEls.set(key, rowElements[index]);
      });

      updateTruthSelection();
    }

    function updateTruthSelection() {
      if (!model || !model.truthTable || !model.truthTable.rows) return;
      const table = model.truthTable;
      const key = table.inputs.map(function (input) { return inputValue(input.name, input.width); }).join("|");
      const next = truthRowEls.get(key) || null;
      if (next === activeTruthRowEl) return;
      if (activeTruthRowEl) activeTruthRowEl.classList.remove("active-row");
      activeTruthRowEl = next;
      if (activeTruthRowEl) activeTruthRowEl.classList.add("active-row");
    }

    function renderWaveform() {
      if (!model) return;
      if (!model.waveform) {
        waveformChart.innerHTML = '<div class="empty-state">' + (requested.waveform ? "Computing waveform preview…" : "Open the Waveform tab to compute the preview.") + '</div>';
        return;
      }

      const waveform = model.waveform;
      if (waveform.error) {
        waveformChart.innerHTML = '<div class="empty-state">' + escapeHtml(waveform.error) + '</div>';
        return;
      }
      if (!waveform.timeSteps || waveform.timeSteps.length === 0) {
        waveformChart.innerHTML = '<div class="empty-state">No waveform data available.</div>';
        return;
      }

      let html = '<div style="font-size: 11px; color: var(--text-faint); margin-bottom: 12px;">' + waveform.timeSteps.length + ' simulated steps</div>';
      const signals = waveform.inputNames.map(function (name) { return { name: name, isInput: true }; })
        .concat(waveform.outputNames.map(function (name) { return { name: name, isInput: false }; }));

      signals.forEach(function (signal) {
        html += '<div class="wave-row">' +
          '<div class="wave-label">' + escapeHtml(signal.name) + ' <span class="tab-badge">' + (signal.isInput ? "in" : "out") + '</span></div>' +
          '<div class="wave-canvas-wrap">' +
            '<svg class="wave-svg" viewBox="0 0 ' + (waveform.timeSteps.length * 30) + ' 24" preserveAspectRatio="none">';

        let path = "";
        waveform.timeSteps.forEach(function (step, index) {
          const value = signal.isInput ? step.inputs[signal.name] : step.outputs[signal.name];
          const high = isHighValue(value);
          const y = high ? 3 : 21;
          const x = index * 30;
          if (index === 0) path += "M " + x + " " + y + " L " + (x + 30) + " " + y;
          else path += " L " + x + " " + y + " L " + (x + 30) + " " + y;
        });

        html += '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2" /></svg></div></div>';
      });

      waveformChart.innerHTML = html;
    }

    function renderTests() {
      if (!model) return;
      if (!model.tests || !model.tests.suites) {
        testsList.innerHTML = '<div class="empty-state">No tests found in source.</div>';
        testsCount.textContent = "0";
        testsSummary.innerHTML = "";
        return;
      }

      const tests = model.tests;
      testsCount.textContent = tests.passed + tests.failed + (tests.unsupported || 0);
      const failed = tests.failed > 0;
      const unsupported = (tests.unsupported || 0) > 0;
      const allPassed = !failed && !unsupported;
      const statusClass = allPassed ? "badge-pass" : failed ? "badge-fail" : "badge-warn";
      const statusText = allPassed ? "ALL TESTS PASSED" : failed ? "TESTS FAILED" : "SOME TESTS UNSUPPORTED";

      testsSummary.innerHTML =
        '<span><strong>Status:</strong> <span class="' + statusClass + '">' + statusText + '</span></span>' +
        '<span>Passed: <strong>' + tests.passed + '</strong></span>' +
        '<span>Failed: <strong>' + tests.failed + '</strong></span>' +
        (unsupported ? '<span>Unsupported: <strong>' + tests.unsupported + '</strong></span>' : "");

      let html = "";
      tests.suites.forEach(function (suite) {
        const suiteClass = !suite.runnable ? "badge-warn" : suite.pass ? "badge-pass" : "badge-fail";
        const suiteText = !suite.runnable ? "UNSUPPORTED" : suite.pass ? "PASS" : "FAIL";
        html += '<div class="test-suite-card">' +
          '<div class="suite-header"><span>' + escapeHtml(suite.name) + '</span><span class="' + suiteClass + '">' + suiteText + '</span></div>';
        if (suite.reason) html += '<div class="case-item">' + escapeHtml(suite.reason) + '</div>';

        suite.cases.forEach(function (testCase) {
          html += '<div class="case-item"><span>' + escapeHtml(testCase.label) +
            (testCase.error ? '<br><span class="case-error">' + escapeHtml(testCase.error) + '</span>' : '') +
            '</span><span class="' + (testCase.pass ? "badge-pass" : "badge-fail") + '">' + (testCase.pass ? "PASS" : "FAIL") + '</span></div>';

          if (testCase.rows && testCase.rows.length > 0) {
            html += '<div class="test-rows">';
            testCase.rows.forEach(function (row) {
              if (row.kind === "input") {
                html += '<div class="test-row input-row"><span class="row-kind">' + (row.step ? "STEP " + row.step : "INPUT") + '</span><span class="row-name">' + escapeHtml(row.name) + '</span><span class="row-value">' + escapeHtml(row.actual) + '</span></div>';
              } else {
                html += '<div class="test-row expect-row ' + (row.pass ? "pass" : "fail") + '"><span class="row-kind">' + (row.step ? "STEP " + row.step : "EXPECT") + '</span><span class="row-name">' + escapeHtml(row.name) + '</span><span class="expect-values"><span class="row-value">' + escapeHtml(row.expected) + '</span>' + (!row.pass ? '<span class="arrow">→</span><span class="row-value actual">' + escapeHtml(row.actual) + '</span>' : '') + '</span><span class="row-result">' + (row.pass ? "✓" : "✗") + '</span></div>';
              }
            });
            html += '</div>';
          }
        });
        html += '</div>';
      });
      testsList.innerHTML = html;
    }

    function renderIr() {
      if (!model || !model.ir) {
        irPre.textContent = "No IR available.";
        return;
      }
      if (model.irText !== null && model.irText !== undefined) {
        irPre.textContent = model.irText;
      } else {
        irPre.textContent = requested.irText ? "Loading lowered IR…" : "Open the IR tab to load the lowered IR.";
      }
    }

    function applySimulation(payload) {
      if (!model || !payload) return;
      model.inputs = payload.inputs || model.inputs;
      model.snapshot = payload.snapshot || model.snapshot;
      updateInputValues();
      updateOutputValues();
      updateGraphValues();
      updateTruthSelection();
      if (selectedNodeId) {
        const node = layoutNodeById.get(selectedNodeId);
        if (node) updateInspector(node);
      }
    }

    function applyDerived(kind, payload) {
      if (!model) return;
      requested[kind] = true;
      if (kind === "truthTable") {
        model.truthTable = payload;
        renderTruthTable();
      } else if (kind === "waveform") {
        model.waveform = payload;
        renderWaveform();
      } else if (kind === "irText") {
        model.irText = payload;
        renderIr();
      }
    }

    // Message listener from extension host
    window.addEventListener("message", function (event) {
      const message = event.data || {};
      if (message.type === "update") render(message.payload || null, Boolean(message.forceReset));
      else if (message.type === "simulation") applySimulation(message.payload);
      else if (message.type === "derived") applyDerived(message.kind, message.payload);
      else if (message.type === "setTab") setActiveTab(message.tab);
    });

    syncTabButtons();
    if (model) {
      render(model);
      setTimeout(fitGraph, 50);
    } else {
      render(null);
    }
    try { vscode.postMessage({ type: "ready" }); } catch (_) {}
  </script>
</body>
</html>`;
}
