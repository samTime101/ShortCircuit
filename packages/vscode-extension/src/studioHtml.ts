import type { GraphLayout } from "./graphLayout";

export interface StudioCircuitData {
  name: string;
  stats: {
    nodes: number;
    states: number;
    events: number;
    maxDepth: number;
    maxWidth: number;
  };
  sequential: boolean;
  inputs: Array<{ name: string; width: number }>;
  outputs: Array<{ name: string; width: number }>;
}

export interface StudioModel {
  circuits: StudioCircuitData[];
  activeCircuit: string;
  inputs: Record<string, string>;
  snapshot: {
    inputs: Record<string, { width: number; binary: string; decimal?: string }>;
    outputs: Record<string, { width: number; binary: string; decimal?: string }>;
    nodes: Record<string, string>;
    runtimeError?: { code: string; message: string };
  } | null;
  layout: GraphLayout | null;
  truthTable: {
    circuit: string;
    inputs: Array<{ name: string; width: number }>;
    outputs: Array<{ name: string; width: number }>;
    rows: Array<{ input: Record<string, string>; output: Record<string, string> }>;
    truncated?: boolean;
    reason?: string;
  } | null;
  waveform: {
    timeSteps: Array<{ inputs: Record<string, string>; outputs: Record<string, string> }>;
    inputNames: string[];
    outputNames: string[];
    error?: string;
  } | null;
  tests: {
    ok: boolean;
    passed: number;
    failed: number;
    suites: Array<{
      name: string;
      pass: boolean;
      cases: Array<{
        label: string;
        pass: boolean;
        rows?: Array<{ kind: string; name: string; expected?: string; actual?: string }>;
      }>;
    }>;
  } | null;
  ir: unknown;
  diagnostics: Array<{ message: string; severity: string; line: number; column: number }>;
  isSidebar?: boolean;
}

export function getStudioHtml(initialModel: StudioModel | null): string {
  const modelJson = JSON.stringify(initialModel || null);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
      border-bottom: 1px solid var(--line);
      max-height: 52%;
      overflow-y: auto;
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
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      padding: 10px 12px;
    }

    .sim-group {
      display: flex;
      flex-direction: column;
      min-width: 0;
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

    .graph-node.value-low .node-value {
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
      stroke-width: 1.4px;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 0.15s, stroke-width 0.15s;
    }

    .graph-edge.high path {
      stroke: var(--accent);
      stroke-width: 2px;
      filter: drop-shadow(0 0 3px rgba(108, 158, 255, 0.45));
    }

    .graph-edge.low path {
      stroke: rgba(110, 128, 168, 0.3);
      stroke-width: 1.2px;
    }

    .graph-edge.is-active path {
      stroke: var(--violet);
      stroke-width: 2.2px;
      filter: drop-shadow(0 0 4px rgba(155, 140, 232, 0.6));
    }

    .edge-width rect {
      fill: var(--panel-2);
      stroke: var(--line-strong);
      stroke-width: 1;
    }

    .edge-width text {
      fill: var(--text-faint);
      font-family: var(--font-mono);
      font-size: 9px;
      dominant-baseline: central;
      pointer-events: none;
    }

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
    </div>
  </div>

  <!-- Content Container -->
  <div class="view-container">
    <!-- Empty / Welcome State -->
    <div id="empty-state" class="empty-state" style="display: none;">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-faint);"><path d="M4 6h5l4 6h7M4 18h5l4-6"/><circle cx="20" cy="12" r="2"/></svg>
      <h3>No LogicFlow file active</h3>
      <p>Open or focus a <code>.lf</code> file in the editor to start live circuit simulation.</p>
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
          <div class="sim-group outputs-group">
            <div class="sim-group-title">
              <span>Outputs</span>
              <span id="output-count-badge" class="group-count">0</span>
            </div>
            <div id="outputs-list" class="monitor-list"></div>
          </div>
        </div>
      </div>

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
    let model = ${modelJson};
    let activeTab = "circuit";
    let selectedNodeId = null;
    let hoveredNodeId = null;

    // Clock Runner State
    let clockRunning = false;
    let clockInterval = null;
    let clockSpeed = 2;
    let selectedClock = null;

    // Elements
    const emptyState = document.getElementById("empty-state");
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
    const graphToolbar = document.querySelector(".graph-toolbar");
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
        } catch {
          return s.slice(0, 6) + "…";
        }
      }
      return s.slice(0, 8) + "…";
    }

    function decimalValue(binary) {
      if (!binary) return "—";
      try {
        return BigInt("0b" + String(binary).replace(/[^01]/g, "")).toString(10);
      } catch {
        return "—";
      }
    }

    // Tab buttons
    document.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
        btn.classList.add("active");
        activeTab = btn.getAttribute("data-tab");
        const target = document.getElementById("tab-" + activeTab);
        if (target) target.classList.add("active");
      });
    });

    // Circuit Picker Change
    circuitPicker.addEventListener("change", (e) => {
      stopClock();
      vscode.postMessage({ type: "selectCircuit", name: e.target.value });
    });

    // Reset button
    btnReset.addEventListener("click", () => {
      stopClock();
      vscode.postMessage({ type: "resetInputs" });
    });

    // Expand button
    btnExpand.addEventListener("click", () => {
      vscode.postMessage({ type: "expand" });
    });

    // Refresh buttons
    if (btnRefresh) {
      btnRefresh.addEventListener("click", () => {
        vscode.postMessage({ type: "refresh" });
      });
    }
    if (btnEmptyRefresh) {
      btnEmptyRefresh.addEventListener("click", () => {
        vscode.postMessage({ type: "refresh" });
      });
    }

    // Clock Step & Run
    btnClockStep.addEventListener("click", () => {
      if (selectedClock) {
        vscode.postMessage({ type: "stepClock", clock: selectedClock });
      }
    });

    btnClockRun.addEventListener("click", () => {
      if (clockRunning) {
        stopClock();
      } else {
        startClock();
      }
    });

    clockSelect.addEventListener("change", (e) => {
      selectedClock = e.target.value;
    });

    clockSpeedSelect.addEventListener("change", (e) => {
      clockSpeed = Number(e.target.value);
      if (clockRunning) {
        stopClock();
        startClock();
      }
    });

    function startClock() {
      if (!selectedClock) return;
      clockRunning = true;
      btnClockRun.classList.add("is-active");
      clockRunText.textContent = "Pause";
      clockRunIcon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
      const ms = Math.max(60, Math.round(1000 / clockSpeed));
      clockInterval = setInterval(() => {
        if (selectedClock) {
          vscode.postMessage({ type: "stepClock", clock: selectedClock });
        }
      }, ms);
    }

    function stopClock() {
      clockRunning = false;
      if (clockInterval) {
        clearInterval(clockInterval);
        clockInterval = null;
      }
      btnClockRun.classList.remove("is-active");
      clockRunText.textContent = "Run";
      clockRunIcon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
    }

    // Zoom and Pan
    let panX = 40;
    let panY = 40;
    let zoomScale = 1.0;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let hasMoved = false;

    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      zoomScale = Math.min(zoomScale * 1.25, 3.0);
      applyTransform();
    });

    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      zoomScale = Math.max(zoomScale / 1.25, 0.15);
      applyTransform();
    });

    document.getElementById("btn-zoom-fit").addEventListener("click", () => {
      fitGraph();
    });

    circuitGraphSvg.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("[data-graph-node]")) return;
      isDragging = true;
      hasMoved = false;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
      circuitGraphSvg.classList.add("is-dragging");
      try { circuitGraphSvg.setPointerCapture(e.pointerId); } catch (_) {}
    });

    circuitGraphSvg.addEventListener("pointermove", (e) => {
      if (!isDragging) return;
      const newX = e.clientX - startX;
      const newY = e.clientY - startY;
      if (Math.abs(newX - panX) + Math.abs(newY - panY) > 3) {
        hasMoved = true;
      }
      panX = newX;
      panY = newY;
      applyTransform();
    });

    circuitGraphSvg.addEventListener("pointerup", (e) => {
      if (isDragging && !hasMoved) {
        selectNode(null);
      }
      isDragging = false;
      circuitGraphSvg.classList.remove("is-dragging");
      try { circuitGraphSvg.releasePointerCapture(e.pointerId); } catch (_) {}
    });

    circuitGraphSvg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = circuitGraphSvg.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.88 : 1.14;
      const nextScale = Math.max(0.12, Math.min(3.0, zoomScale * factor));
      if (nextScale === zoomScale) return;
      const ratio = nextScale / zoomScale;
      panX = cx - (cx - panX) * ratio;
      panY = cy - (cy - panY) * ratio;
      zoomScale = nextScale;
      applyTransform();
    }, { passive: false });

    function applyTransform() {
      graphWorld.setAttribute("transform", "translate(" + panX + " " + panY + ") scale(" + zoomScale + ")");
    }

    function fitGraph() {
      if (!model || !model.layout) return;
      const rect = circuitGraphSvg.getBoundingClientRect();
      const vw = rect.width || 600;
      const vh = rect.height || 400;
      const lw = model.layout.width || 600;
      const lh = model.layout.height || 400;
      const scaleX = (vw - 60) / lw;
      const scaleY = (vh - 60) / lh;
      zoomScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.25), 1.15);
      panX = Math.max(20, (vw - lw * zoomScale) / 2);
      panY = Math.max(20, (vh - lh * zoomScale) / 2);
      applyTransform();
    }

    // Node selection and inspector
    document.getElementById("btn-close-insp").addEventListener("click", () => {
      selectNode(null);
    });

    circuitGraphSvg.addEventListener("click", (e) => {
      const nodeEl = e.target.closest("[data-graph-node]");
      if (nodeEl) {
        const id = nodeEl.getAttribute("data-id");
        selectNode(id);
      }
    });

    function selectNode(id) {
      selectedNodeId = id;
      if (!id || !model || !model.layout) {
        graphInspector.style.display = "none";
        updateActiveElements();
        return;
      }

      const node = model.layout.nodes.find(n => n.id === id);
      if (!node) {
        graphInspector.style.display = "none";
        return;
      }

      let val = undefined;
      if (node.kind === "output") {
        val = model.snapshot && model.snapshot.outputs && model.snapshot.outputs[node.label] ? model.snapshot.outputs[node.label].binary : undefined;
      } else if (node.kind === "input") {
        val = model.inputs[node.label] || (model.snapshot && model.snapshot.inputs && model.snapshot.inputs[node.label] ? model.snapshot.inputs[node.label].binary : "0");
      } else {
        val = model.snapshot && model.snapshot.nodes ? model.snapshot.nodes[node.id] : undefined;
      }

      document.getElementById("insp-title").textContent = node.title || (node.kind.toUpperCase() + " COMPONENT");
      document.getElementById("insp-label").textContent = node.label;
      document.getElementById("insp-val").textContent = compactValue(val, node.width);
      document.getElementById("insp-bits").textContent = node.width + " bit" + (node.width === 1 ? "" : "s");
      document.getElementById("insp-dec").textContent = decimalValue(val);
      document.getElementById("insp-kind").textContent = node.kind === "output" ? (node.sourceId ? node.sourceId.split("/").pop() : "output") : (node.kind === "operation" ? (node.op || "operation") : node.kind);
      document.getElementById("insp-scope").textContent = node.scope && node.scope.length ? node.scope.join(".") : "top level";
      document.getElementById("insp-line").textContent = "line " + (node.line || 1);

      graphInspector.style.display = "block";
      updateActiveElements();
    }

    function updateActiveElements() {
      const activeId = selectedNodeId || hoveredNodeId;
      document.querySelectorAll(".graph-node").forEach(n => {
        const id = n.getAttribute("data-id");
        if (activeId && id === activeId) {
          n.classList.add("is-active");
        } else {
          n.classList.remove("is-active");
        }
      });

      document.querySelectorAll(".graph-edge").forEach(e => {
        const from = e.getAttribute("data-from");
        const to = e.getAttribute("data-to");
        if (activeId && (from === activeId || to === activeId)) {
          e.classList.add("is-active");
        } else {
          e.classList.remove("is-active");
        }
      });
    }

    function render(newModel) {
      const prevActiveCircuit = model ? model.activeCircuit : null;
      model = newModel;
      if (!model || !model.circuits || model.circuits.length === 0) {
        emptyState.style.display = "flex";
        document.querySelectorAll(".tab-content").forEach(c => c.style.display = "none");
        circuitPicker.innerHTML = "";
        circuitPicker.style.display = "none";
        return;
      }
      circuitPicker.style.display = "";
      emptyState.style.display = "none";
      document.querySelectorAll(".tab-content").forEach(c => c.style.display = "");
      const currentTabEl = document.getElementById("tab-" + activeTab);
      if (currentTabEl) currentTabEl.classList.add("active");

      // Diagnostics banner
      if (model.diagnostics && model.diagnostics.length > 0) {
        const error = model.diagnostics.find(d => d.severity === "error") || model.diagnostics[0];
        diagBanner.style.display = "flex";
        diagText.textContent = "Line " + error.line + ": " + error.message;
      } else {
        diagBanner.style.display = "none";
      }

      // Populate circuit picker
      circuitPicker.innerHTML = "";
      model.circuits.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = "Circuit " + c.name;
        if (c.name === model.activeCircuit) opt.selected = true;
        circuitPicker.appendChild(opt);
      });

      const activeCircuit = model.circuits.find(c => c.name === model.activeCircuit) || model.circuits[0];
      if (!activeCircuit) return;

      circuitNodeCount.textContent = activeCircuit.stats.nodes;
      graphNodesCount.textContent = activeCircuit.stats.nodes + " nodes";
      graphLayersCount.textContent = (model.layout ? model.layout.depth : 0) + " layers";

      // Toolbar info
      graphCircuitName.textContent = activeCircuit.name;
      graphMeta.textContent = activeCircuit.stats.nodes + " nodes • " + activeCircuit.stats.maxDepth + " deep • " + (activeCircuit.stats.maxWidth || 1) + "b max width";
      graphModeBadge.textContent = activeCircuit.sequential ? "Sequential" : "Combinational";
      if (activeCircuit.sequential) {
        graphModeBadge.classList.add("sequential");
      } else {
        graphModeBadge.classList.remove("sequential");
      }

      // Large graph warning
      if (activeCircuit.stats.nodes > 90) {
        graphWarning.style.display = "block";
      } else {
        graphWarning.style.display = "none";
      }

      // Clocks & Clock Runner
      const clockNames = [];
      if (model.ir && Array.isArray(model.ir.events)) {
        model.ir.events.forEach(e => {
          if (e && e.clock) {
            const foundNode = model.ir.nodes && model.ir.nodes.find(n => n.id === e.clock);
            const clkName = foundNode && foundNode.inputName ? foundNode.inputName : e.clock;
            if (!clockNames.includes(clkName)) clockNames.push(clkName);
          }
        });
      }

      if (clockNames.length > 0) {
        dockControlsRow.style.display = "flex";
        simClockHint.style.display = "inline-flex";

        const currentChoice = clockSelect.value;
        clockSelect.innerHTML = "";
        clockNames.forEach(c => {
          const opt = document.createElement("option");
          opt.value = c;
          opt.textContent = c;
          clockSelect.appendChild(opt);
        });

        if (currentChoice && clockNames.includes(currentChoice)) {
          clockSelect.value = currentChoice;
          selectedClock = currentChoice;
        } else {
          selectedClock = clockNames[0];
          clockSelect.value = selectedClock;
        }
      } else {
        dockControlsRow.style.display = "none";
        simClockHint.style.display = "none";
        stopClock();
      }

      // Render Inputs
      renderInputs(activeCircuit, clockNames);

      // Render Outputs
      renderOutputs(activeCircuit);

      // Render Graph
      renderGraph();

      // Render Truth Table
      renderTruthTable();

      // Render Waveform
      renderWaveform();

      // Render Tests
      renderTests();

      // Render IR
      irPre.textContent = JSON.stringify(model.ir || activeCircuit, null, 2);

      // Auto-fit if circuit changed
      if (prevActiveCircuit !== activeCircuit.name) {
        setTimeout(fitGraph, 40);
      }
    }

    const outputDisplayModes = {};

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
      const segs = SEGMENTS[hexChar] || SEGMENTS["0"];
      let paths = "";
      for (let i = 0; i < 7; i++) {
        const on = segs[i];
        paths += '<path d="' + SEGMENT_SHAPES[i] + '" fill="' + (on ? '#6c9eff' : 'rgba(255,255,255,0.06)') + '" ' + (on ? 'filter="drop-shadow(0 0 2px #6c9eff)"' : '') + '/>';
      }
      return '<svg class="seven-seg-svg" viewBox="0 0 28 36" width="20" height="26">' + paths + '</svg><span class="decimal-value bus-decimal">#' + hexChar + '</span>';
    }

    function renderInputs(circuit, clockNames = []) {
      inputsList.innerHTML = "";
      inputCountBadge.textContent = circuit.inputs.length;

      if (circuit.inputs.length === 0) {
        inputsList.innerHTML = '<div class="io-empty">This circuit has no external inputs.</div>';
        return;
      }

      circuit.inputs.forEach(inp => {
        let val = model.inputs[inp.name] || "0";
        if (inp.width > 1 && val.length < inp.width) {
          val = val.padStart(inp.width, "0");
        }
        const isHigh = val === "1" || parseInt(val, 2) > 0;
        const isClock = clockNames.includes(inp.name);

        const row = document.createElement("div");
        row.className = "io-control " + (inp.width === 1 ? "bit-control" : "bus-control") + (isClock ? " is-clock" : "");

        const labelRow = document.createElement("div");
        labelRow.className = "io-label-row";
        labelRow.innerHTML = 
          '<span class="io-label">' +
            (isClock ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' : '') +
            escapeHtml(inp.name) +
          '</span>' +
          '<span class="io-width">' + inp.width + 'b</span>';

        if (inp.width === 1) {
          row.appendChild(labelRow);

          const sw = document.createElement("button");
          sw.className = "bit-switch" + (isHigh ? " is-on" : "");
          sw.setAttribute("aria-label", "Toggle " + inp.name);
          sw.setAttribute("aria-pressed", isHigh ? "true" : "false");
          sw.innerHTML = 
            '<span class="bit-switch-track"><span class="bit-switch-thumb"></span></span>' +
            '<span class="bit-switch-value">' + (isHigh ? "1" : "0") + '</span>';

          sw.addEventListener("click", () => {
            vscode.postMessage({ type: "toggleInput", name: inp.name });
          });
          row.appendChild(sw);
        } else if (inp.width > 16) {
          row.appendChild(labelRow);

          const wideRow = document.createElement("div");
          wideRow.className = "bus-wide-row";

          const textField = document.createElement("div");
          textField.className = "bus-text-field";

          const inpBox = document.createElement("input");
          inpBox.className = "bus-text-input";
          inpBox.value = val;
          inpBox.spellcheck = false;
          inpBox.title = "Type binary (e.g. 100000), hex (0x20), or decimal";

          const commitChange = () => {
            vscode.postMessage({ type: "setInput", name: inp.name, value: inpBox.value });
          };
          inpBox.addEventListener("change", commitChange);
          inpBox.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              commitChange();
              inpBox.blur();
            }
          });
          textField.appendChild(inpBox);
          wideRow.appendChild(textField);

          const decVal = decimalValue(val);
          const decBadge = document.createElement("span");
          decBadge.className = "decimal-value bus-decimal";
          decBadge.textContent = "#" + decVal;
          decBadge.title = inp.name + " is " + decVal + " in decimal";
          wideRow.appendChild(decBadge);
          row.appendChild(wideRow);
        } else {
          row.appendChild(labelRow);

          const cellsRow = document.createElement("div");
          cellsRow.className = "bus-cells-row";

          const bitCells = document.createElement("div");
          bitCells.className = "bit-cells";
          bitCells.setAttribute("aria-label", inp.name + " bits");

          for (let i = 0; i < inp.width; i++) {
            const bit = val[i] || "0";
            const bitIdx = inp.width - 1 - i;
            const cell = document.createElement("button");
            cell.className = "bit-cell" + (bit === "1" ? " is-on" : "");
            cell.textContent = bit;
            cell.title = inp.name + "[" + bitIdx + "] = " + bit + ". Click to flip.";
            cell.addEventListener("click", () => {
              vscode.postMessage({ type: "flipBit", name: inp.name, bitIndex: bitIdx });
            });
            bitCells.appendChild(cell);
          }
          cellsRow.appendChild(bitCells);

          const decVal = decimalValue(val);
          const decBadge = document.createElement("span");
          decBadge.className = "decimal-value bus-decimal";
          decBadge.textContent = "#" + decVal;
          decBadge.title = inp.name + " is " + decVal + " in decimal";
          cellsRow.appendChild(decBadge);

          row.appendChild(cellsRow);
        }

        inputsList.appendChild(row);
      });
    }

    function renderOutputs(circuit) {
      outputsList.innerHTML = "";
      outputCountBadge.textContent = circuit.outputs.length;

      if (circuit.outputs.length === 0) {
        outputsList.innerHTML = '<div class="io-empty">No outputs are exposed.</div>';
      } else {
        circuit.outputs.forEach(out => {
          const snap = model.snapshot && model.snapshot.outputs ? model.snapshot.outputs[out.name] : null;
          let val = snap ? snap.binary : "0";
          if (out.width > 1 && val.length < out.width) {
            val = val.padStart(out.width, "0");
          }
          const isHigh = val === "1" || (parseInt(val, 2) || 0) > 0;
          const decVal = snap && snap.decimal !== undefined ? snap.decimal : decimalValue(val);

          const row = document.createElement("div");
          row.className = "monitor-row";

          const labelDiv = document.createElement("div");
          labelDiv.className = "monitor-label";
          labelDiv.innerHTML = 
            '<span class="monitor-led ' + (isHigh ? "hot" : "") + '"></span>' +
            '<span>' + escapeHtml(out.name) + '</span>' +
            '<span class="io-width">' + out.width + 'b</span>';
          row.appendChild(labelDiv);

          const valDiv = document.createElement("div");
          valDiv.className = "monitor-value";

          if (out.width === 1) {
            const pill = document.createElement("span");
            pill.className = "output-pill" + (isHigh ? " high" : "");
            pill.textContent = isHigh ? "1" : "0";
            pill.title = out.name + " is " + (isHigh ? "HIGH (1)" : "LOW (0)");
            valDiv.appendChild(pill);
          } else {
            const mode = outputDisplayModes[out.name] || "number";

            if (mode === "number") {
              const numSpan = document.createElement("span");
              numSpan.className = "display-number";
              numSpan.innerHTML = '<span class="binary-value">' + val + '</span><span class="decimal-value">#' + decVal + '</span>';
              valDiv.appendChild(numSpan);
            } else if (mode === "led") {
              const leds = document.createElement("span");
              leds.className = "display-leds";
              for (let i = 0; i < val.length; i++) {
                const led = document.createElement("span");
                led.className = "led-dot" + (val[i] === "1" ? " on" : "");
                leds.appendChild(led);
              }
              valDiv.appendChild(leds);
            } else if (mode === "seven") {
              const s7 = document.createElement("span");
              s7.innerHTML = renderSevenSegment(val);
              valDiv.appendChild(s7);
            } else if (mode === "bar") {
              const max = (1n << BigInt(out.width)) - 1n;
              const cur = BigInt(decVal || 0);
              const pct = max > 0n ? Math.min(100, Math.round(Number((cur * 100n) / max))) : 0;
              const barDiv = document.createElement("span");
              barDiv.style.display = "inline-flex";
              barDiv.style.alignItems = "center";
              barDiv.style.gap = "6px";
              barDiv.innerHTML = '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div><span class="decimal-value">#' + decVal + '</span>';
              valDiv.appendChild(barDiv);
            }

            const modeSelect = document.createElement("select");
            modeSelect.className = "display-mode-select";
            [
              { id: "number", label: "Number" },
              { id: "led", label: "LEDs" },
              { id: "seven", label: "7-segment" },
              { id: "bar", label: "Bar" }
            ].forEach(opt => {
              const option = document.createElement("option");
              option.value = opt.id;
              option.textContent = opt.label;
              if (opt.id === mode) option.selected = true;
              modeSelect.appendChild(option);
            });
            modeSelect.addEventListener("change", (e) => {
              outputDisplayModes[out.name] = e.target.value;
              renderOutputs(circuit);
            });
            valDiv.appendChild(modeSelect);
          }

          row.appendChild(valDiv);
          outputsList.appendChild(row);
        });
      }

      // Stored States (if sequential circuit)
      if (model.ir && Array.isArray(model.ir.states) && model.ir.states.length > 0) {
        const stateBlock = document.createElement("div");
        stateBlock.className = "state-block";
        stateBlock.innerHTML = '<div class="state-title">Stored state</div>';

        model.ir.states.forEach(st => {
          const val = (model.snapshot && model.snapshot.nodes ? model.snapshot.nodes[st.node] : undefined) || "0".repeat(st.width);
          const decVal = decimalValue(val);
          const sRow = document.createElement("div");
          sRow.className = "monitor-row";
          sRow.innerHTML = 
            '<div class="monitor-label">' +
              '<span class="state-glyph">S</span>' +
              '<span>' + escapeHtml(st.name) + '</span>' +
              '<span class="io-width">' + st.width + 'b</span>' +
            '</div>' +
            '<div class="monitor-value">' +
              '<span class="display-number">' +
                '<span class="binary-value">' + val + '</span>' +
                (st.width > 1 ? '<span class="decimal-value">#' + decVal + '</span>' : '') +
              '</span>' +
            '</div>';
          stateBlock.appendChild(sRow);
        });
        outputsList.appendChild(stateBlock);
      }
    }

    function renderGraph() {
      if (!model.layout) return;
      const layout = model.layout;

      // 1. Render edges
      let edgesHtml = "";
      let widthsHtml = "";

      layout.edges.forEach(edge => {
        const fromVal = (model.snapshot && model.snapshot.nodes ? model.snapshot.nodes[edge.from] : undefined) || (model.inputs[edge.from] || "0");
        const isHigh = fromVal === "1" || parseInt(fromVal, 2) > 0;
        const tone = isHigh ? "high" : "low";

        edgesHtml += '<g class="graph-edge ' + tone + '" data-from="' + escapeHtml(edge.from) + '" data-to="' + escapeHtml(edge.to) + '">' +
          '<path d="' + edge.path + '" vector-effect="non-scaling-stroke"></path>' +
        '</g>';

        if (edge.width > 1) {
          widthsHtml += '<g class="edge-width" transform="translate(' + edge.labelX + ' ' + edge.labelY + ')">' +
            '<rect x="-10" y="-8" width="20" height="13" rx="4"></rect>' +
            '<text x="0" y="0" text-anchor="middle">' + edge.width + 'b</text>' +
          '</g>';
        }
      });
      graphEdgesLayer.innerHTML = edgesHtml;
      graphWidthsLayer.innerHTML = widthsHtml;

      // 2. Render SVG Nodes (Exact Web UI Layout & Typography)
      let nodesHtml = "";

      layout.nodes.forEach(node => {
        let val = undefined;
        if (node.kind === "output") {
          val = model.snapshot && model.snapshot.outputs && model.snapshot.outputs[node.label] ? model.snapshot.outputs[node.label].binary : undefined;
        } else if (node.kind === "input") {
          val = model.inputs[node.label] || (model.snapshot && model.snapshot.inputs && model.snapshot.inputs[node.label] ? model.snapshot.inputs[node.label].binary : "0");
        } else {
          val = model.snapshot && model.snapshot.nodes ? model.snapshot.nodes[node.id] : undefined;
        }

        const isHigh = val && (val === "1" || val.includes("1"));
        const valState = val === undefined ? "unknown" : (isHigh ? "high" : "low");
        const isConst = node.kind === "constant";
        const rx = isConst ? 9 : 11;
        const labelX = node.kind === "operation" ? 45 : 13;
        const compactVal = compactValue(val, node.width);

        nodesHtml += 
          '<g data-graph-node data-id="' + escapeHtml(node.id) + '" class="graph-node kind-' + node.kind + ' value-' + valState + '" transform="translate(' + node.x + ' ' + node.y + ')" tabindex="0" role="button" aria-label="' + escapeHtml(node.label) + '">' +
            '<rect class="node-card" x="0" y="0" width="' + node.w + '" height="' + node.h + '" rx="' + rx + '"></rect>' +
            '<rect class="node-accent" x="0" y="12" width="3" height="' + (node.h - 24) + '" rx="2"></rect>' +
            (node.kind === "operation" ? '<text class="node-op-glyph" x="13" y="21">' + escapeHtml(node.opGlyph) + '</text>' : '') +
            '<text class="node-label" x="' + labelX + '" y="22">' + escapeHtml(node.displayLabel) + '</text>' +
            '<text class="node-sub" x="13" y="' + (node.h - 12) + '">' + escapeHtml(node.subLabel) + '</text>' +
            '<text class="node-value" x="' + (node.w - 11) + '" y="22" text-anchor="end">' + escapeHtml(compactVal) + '</text>' +
            (node.width > 1 ? '<text class="node-width" x="' + (node.w - 11) + '" y="' + (node.h - 12) + '" text-anchor="end">' + node.width + 'b</text>' : '') +
          '</g>';
      });
      graphNodesLayer.innerHTML = nodesHtml;

      // Update hover events
      document.querySelectorAll(".graph-node").forEach(nodeEl => {
        const id = nodeEl.getAttribute("data-id");
        nodeEl.addEventListener("mouseenter", () => {
          hoveredNodeId = id;
          updateActiveElements();
        });
        nodeEl.addEventListener("mouseleave", () => {
          hoveredNodeId = null;
          updateActiveElements();
        });
      });

      updateActiveElements();
    }

    function renderTruthTable() {
      if (!model.truthTable || !model.truthTable.rows) {
        truthTableView.innerHTML = '<div class="empty-state">No truth table available for sequential circuits.</div>';
        truthRowCount.textContent = "0";
        return;
      }
      const tt = model.truthTable;
      truthRowCount.textContent = tt.rows.length;

      let html = '<table class="truth-table"><thead><tr>';
      tt.inputs.forEach(i => html += '<th>' + escapeHtml(i.name) + '</th>');
      tt.outputs.forEach(o => html += '<th>' + escapeHtml(o.name) + '</th>');
      html += '</tr></thead><tbody>';

      tt.rows.forEach(row => {
        let isMatch = true;
        tt.inputs.forEach(i => {
          if (row.input[i.name] !== (model.inputs[i.name] || "0")) isMatch = false;
        });

        html += '<tr class="' + (isMatch ? "active-row" : "") + '">';
        tt.inputs.forEach(i => html += '<td>' + escapeHtml(row.input[i.name]) + '</td>');
        tt.outputs.forEach(o => html += '<td>' + escapeHtml(row.output[o.name]) + '</td>');
        html += '</tr>';
      });

      html += '</tbody></table>';
      truthTableView.innerHTML = html;
    }

    function renderWaveform() {
      if (!model.waveform || !model.waveform.timeSteps || model.waveform.timeSteps.length === 0) {
        waveformChart.innerHTML = '<div class="empty-state">No waveform data available.</div>';
        return;
      }
      const wf = model.waveform;
      let html = '<div style="font-size: 11px; color: var(--text-faint); margin-bottom: 12px;">' + wf.timeSteps.length + ' simulated steps</div>';

      const allSignals = [
        ...wf.inputNames.map(n => ({ name: n, isInput: true })),
        ...wf.outputNames.map(n => ({ name: n, isInput: false }))
      ];

      allSignals.forEach(sig => {
        html += 
          '<div class="wave-row">' +
            '<div class="wave-label">' + escapeHtml(sig.name) + ' <span class="tab-badge">' + (sig.isInput ? "in" : "out") + '</span></div>' +
            '<div class="wave-canvas-wrap">' +
              '<svg class="wave-svg" viewBox="0 0 ' + (wf.timeSteps.length * 30) + ' 24" preserveAspectRatio="none">';

        let path = "";
        wf.timeSteps.forEach((step, idx) => {
          const val = sig.isInput ? step.inputs[sig.name] : step.outputs[sig.name];
          const isHigh = val === "1" || parseInt(val, 2) > 0;
          const y = isHigh ? 3 : 21;
          const x = idx * 30;
          if (idx === 0) {
            path += 'M ' + x + ' ' + y + ' L ' + (x + 30) + ' ' + y;
          } else {
            path += ' L ' + x + ' ' + y + ' L ' + (x + 30) + ' ' + y;
          }
        });

        html += 
                '<path d="' + path + '" fill="none" stroke="var(--accent)" stroke-width="2" />' +
              '</svg>' +
            '</div>' +
          '</div>';
      });

      waveformChart.innerHTML = html;
    }

    function renderTests() {
      if (!model.tests || !model.tests.suites) {
        testsList.innerHTML = '<div class="empty-state">No tests found in source.</div>';
        testsCount.textContent = "0";
        testsSummary.innerHTML = "";
        return;
      }
      const t = model.tests;
      testsCount.textContent = t.passed + t.failed;
      testsSummary.innerHTML = 
        '<span><strong>Status:</strong> ' + (t.ok ? '<span class="badge-pass">ALL TESTS PASSED</span>' : '<span class="badge-fail">TESTS FAILED</span>') + '</span>' +
        '<span>Passed: <strong>' + t.passed + '</strong></span>' +
        '<span>Failed: <strong>' + t.failed + '</strong></span>';

      let html = "";
      t.suites.forEach(suite => {
        html += 
          '<div class="test-suite-card">' +
            '<div class="suite-header">' +
              '<span>' + escapeHtml(suite.name) + '</span>' +
              '<span class="' + (suite.pass ? "badge-pass" : "badge-fail") + '">' + (suite.pass ? "PASS" : "FAIL") + '</span>' +
            '</div>';
        suite.cases.forEach(c => {
          html += 
            '<div class="case-item">' +
              '<span>' + escapeHtml(c.label) + '</span>' +
              '<span class="' + (c.pass ? "badge-pass" : "badge-fail") + '">' + (c.pass ? "PASS" : "FAIL") + '</span>' +
            '</div>';
        });
        html += '</div>';
      });
      testsList.innerHTML = html;
    }

    // Message listener from extension host
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "update") {
        render(msg.payload);
      } else if (msg.type === "setTab") {
        const btn = document.querySelector('.tab-btn[data-tab="' + msg.tab + '"]');
        if (btn) btn.click();
      }
    });

    if (model) {
      render(model);
      setTimeout(fitGraph, 50);
    }
  </script>
</body>
</html>`;
}
