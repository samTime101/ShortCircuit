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
      --sc-bg: var(--vscode-editor-background, #0c100d);
      --sc-panel-bg: var(--vscode-sideBar-background, #111612);
      --sc-card-bg: rgba(255, 255, 255, 0.03);
      --sc-card-hover: rgba(255, 255, 255, 0.06);
      --sc-border: var(--vscode-panel-border, rgba(255, 255, 255, 0.08));
      --sc-border-strong: rgba(255, 255, 255, 0.16);
      --sc-fg: var(--vscode-foreground, #e5e7eb);
      --sc-muted: var(--vscode-descriptionForeground, #9ca3af);
      --sc-lime: #d1ff52;
      --sc-lime-dim: rgba(209, 255, 82, 0.15);
      --sc-lime-glow: rgba(209, 255, 82, 0.35);
      --sc-wire-low: rgba(255, 255, 255, 0.2);
      --sc-red: #ef4444;
      --sc-red-dim: rgba(239, 68, 68, 0.15);
      --sc-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      --sc-font-mono: var(--vscode-editor-font-family, "JetBrains Mono", Consolas, "Courier New", monospace);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--sc-font);
      background-color: var(--sc-bg);
      color: var(--sc-fg);
      font-size: 12px;
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
      padding: 8px 12px;
      background: var(--sc-panel-bg);
      border-bottom: 1px solid var(--sc-border);
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
      padding: 5px 10px;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      color: var(--sc-muted);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .tab-btn:hover {
      background: var(--sc-card-hover);
      color: var(--sc-fg);
    }

    .tab-btn.active {
      background: var(--sc-card-hover);
      border-color: var(--sc-border-strong);
      color: var(--sc-fg);
    }

    .tab-badge {
      display: inline-block;
      padding: 1px 5px;
      border-radius: 10px;
      font-size: 10px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--sc-muted);
    }

    .tab-btn.active .tab-badge {
      background: var(--sc-lime-dim);
      color: var(--sc-lime);
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
    }

    .circuit-select {
      background: var(--sc-card-bg);
      border: 1px solid var(--sc-border);
      color: var(--sc-fg);
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
      cursor: pointer;
    }

    .circuit-select:focus {
      border-color: var(--sc-lime);
    }

    .btn-action {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--sc-card-bg);
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      color: var(--sc-fg);
      font-size: 11px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-action:hover {
      background: var(--sc-card-hover);
      border-color: var(--sc-border-strong);
    }

    .live-indicator {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--sc-lime);
      padding: 3px 8px;
      border-radius: 12px;
      background: var(--sc-lime-dim);
      border: 1px solid rgba(209, 255, 82, 0.2);
    }

    .live-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--sc-lime);
      box-shadow: 0 0 6px var(--sc-lime);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.9); }
    }

    /* Diagnostics Banner */
    .diagnostics-banner {
      display: none;
      padding: 6px 12px;
      background: var(--sc-red-dim);
      border-bottom: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      font-size: 11px;
      align-items: center;
      gap: 8px;
    }

    /* Content Views */
    .view-container {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .tab-content {
      display: none;
      height: 100%;
      flex-direction: column;
    }

    .tab-content.active {
      display: flex;
    }

    /* Simulator Dock */
    .sim-dock {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--sc-border);
      background: rgba(0, 0, 0, 0.2);
      flex-shrink: 0;
    }

    .sim-column {
      flex: 1 1 240px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .sim-col-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--sc-muted);
      padding-bottom: 6px;
      border-bottom: 1px solid var(--sc-border);
    }

    .sim-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 6px;
      gap: 12px;
      transition: border-color 0.15s, background-color 0.15s;
    }

    .sim-item:hover {
      border-color: rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.04);
    }

    .sim-label-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sim-name {
      font-family: var(--sc-font-mono);
      font-size: 13px;
      font-weight: 700;
      color: var(--sc-fg);
    }

    .sim-width {
      font-size: 11px;
      color: var(--sc-muted);
      font-family: var(--sc-font-mono);
    }

    .sim-controls-group {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .bus-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .bus-text-input {
      background: #090c0a;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      color: #fff;
      font-family: var(--sc-font-mono);
      font-size: 12px;
      padding: 5px 10px;
      text-align: right;
      width: 110px;
      transition: border-color 0.15s;
    }

    .bus-text-input:focus {
      outline: none;
      border-color: var(--sc-lime);
      box-shadow: 0 0 6px rgba(209, 255, 82, 0.3);
    }

    .bus-decimal {
      font-family: var(--sc-font-mono);
      font-size: 11px;
      color: var(--sc-lime);
      background: var(--sc-lime-dim);
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
    }

    .bit-cells {
      display: flex;
      gap: 3px;
    }

    .bit-cell {
      width: 22px;
      height: 24px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.05);
      color: var(--sc-muted);
      font-family: var(--sc-font-mono);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.12s;
    }

    .bit-cell:hover {
      border-color: var(--sc-lime);
      transform: translateY(-1px);
    }

    .bit-cell.is-on {
      background: var(--sc-lime);
      color: #0c100d;
      border-color: var(--sc-lime);
      box-shadow: 0 0 6px rgba(209, 255, 82, 0.4);
    }

    /* Interactive Switch */
    .switch-btn {
      position: relative;
      display: inline-flex;
      align-items: center;
      width: 46px;
      height: 24px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      border: 1px solid var(--sc-border);
      cursor: pointer;
      transition: all 0.2s ease;
      padding: 2px;
    }

    .switch-btn.high {
      background: var(--sc-lime);
      border-color: var(--sc-lime);
      box-shadow: 0 0 10px rgba(209, 255, 82, 0.3);
    }

    .switch-knob {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #fff;
      transition: transform 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      color: #111;
      font-family: var(--sc-font-mono);
    }

    .switch-btn.high .switch-knob {
      transform: translateX(22px);
      background: #0c100d;
      color: var(--sc-lime);
    }

    /* Output Pill */
    .output-pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 42px;
      height: 24px;
      padding: 0 14px;
      border-radius: 12px;
      font-family: var(--sc-font-mono);
      font-size: 12px;
      font-weight: 700;
      background: rgba(255, 255, 255, 0.04);
      color: #777;
      border: 1px solid rgba(255, 255, 255, 0.12);
      transition: all 0.15s ease;
    }

    .output-pill.high {
      background: rgba(209, 255, 82, 0.12);
      color: var(--sc-lime);
      border: 1.5px solid var(--sc-lime);
      box-shadow: 0 0 12px rgba(209, 255, 82, 0.35);
    }

    .sim-output-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .output-display-el {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .display-bin {
      font-family: var(--sc-font-mono);
      font-size: 12px;
      color: var(--sc-fg);
      font-weight: 600;
    }

    .display-mode-select {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--sc-border);
      border-radius: 4px;
      color: var(--sc-muted);
      font-size: 10px;
      padding: 2px 6px;
      cursor: pointer;
    }

    .display-leds {
      display: inline-flex;
      gap: 4px;
      align-items: center;
    }

    .led-dot {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .led-dot.on {
      background: var(--sc-lime);
      border-color: var(--sc-lime);
      box-shadow: 0 0 6px var(--sc-lime);
    }

    .bar-track {
      width: 80px;
      height: 10px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 5px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--sc-lime);
      transition: width 0.2s ease;
    }

    .seven-seg-svg {
      display: inline-block;
      vertical-align: middle;
    }

    /* Graph Section */
    .graph-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      min-height: 240px;
    }

    .graph-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(0, 0, 0, 0.2);
      border-bottom: 1px solid var(--sc-border);
      font-size: 11px;
    }

    .graph-title-group {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--sc-muted);
    }

    .graph-title-group strong {
      color: var(--sc-fg);
    }

    .graph-legend {
      display: flex;
      align-items: center;
      gap: 12px;
      color: var(--sc-muted);
      font-size: 10px;
    }

    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    .legend-line {
      width: 14px;
      height: 2px;
      border-radius: 1px;
    }

    .legend-line.high { background: var(--sc-lime); }
    .legend-line.low { background: var(--sc-wire-low); }

    .zoom-toolbar {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      background: var(--sc-card-bg);
      border: 1px solid var(--sc-border);
      border-radius: 6px;
      padding: 2px;
    }

    .zoom-btn {
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      color: var(--sc-fg);
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
    }

    .zoom-btn:hover { background: var(--sc-card-hover); }

    .graph-viewport {
      flex: 1;
      position: relative;
      overflow: hidden;
      cursor: grab;
      background: 
        radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px);
      background-size: 20px 20px;
    }

    .graph-viewport:active { cursor: grabbing; }

    .graph-world {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
      pointer-events: none;
    }

    .graph-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }

    .wire {
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: stroke 0.2s, stroke-width 0.2s;
    }

    .wire-low {
      stroke: var(--sc-wire-low);
      stroke-width: 1.5px;
    }

    .wire-high {
      stroke: var(--sc-lime);
      stroke-width: 2.4px;
      filter: drop-shadow(0 0 3px rgba(209, 255, 82, 0.5));
    }

    .node-card {
      position: absolute;
      background: #151a16;
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      pointer-events: auto;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: border-color 0.15s, transform 0.15s;
    }

    .node-card:hover {
      border-color: var(--sc-border-strong);
      transform: translateY(-1px);
    }

    .node-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }

    .node-op-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: bold;
      color: var(--sc-lime);
      font-family: var(--sc-font-mono);
    }

    .node-glyph {
      font-size: 12px;
      color: #fff;
    }

    .node-val {
      font-family: var(--sc-font-mono);
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--sc-muted);
    }

    .node-val.high {
      background: var(--sc-lime-dim);
      color: var(--sc-lime);
      font-weight: bold;
    }

    .node-label {
      font-family: var(--sc-font-mono);
      font-size: 11px;
      color: var(--sc-fg);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 4px;
    }

    .node-sub {
      font-size: 9px;
      color: var(--sc-muted);
      margin-top: 2px;
    }

    /* Truth Table */
    .table-container {
      padding: 16px;
      overflow-x: auto;
    }

    .truth-table {
      width: 100%;
      max-width: 900px;
      margin: 0 auto;
      border-collapse: collapse;
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      overflow: hidden;
      font-family: var(--sc-font-mono);
      font-size: 12px;
    }

    .truth-table th, .truth-table td {
      padding: 8px 12px;
      text-align: center;
      border: 1px solid var(--sc-border);
    }

    .truth-table th {
      background: rgba(255, 255, 255, 0.05);
      color: var(--sc-fg);
      font-weight: 600;
    }

    .truth-table tr:nth-child(even) {
      background: rgba(255, 255, 255, 0.02);
    }

    .truth-table tr.active-row {
      background: var(--sc-lime-dim);
      font-weight: bold;
    }

    .truth-table tr.active-row td {
      border-color: rgba(209, 255, 82, 0.3);
      color: var(--sc-lime);
    }

    /* Waveform View */
    .waveform-view {
      padding: 16px;
      overflow-x: auto;
    }

    .waveform-chart {
      min-width: 500px;
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      background: rgba(0,0,0,0.2);
      padding: 16px;
    }

    .wave-row {
      display: flex;
      align-items: center;
      margin-bottom: 12px;
      height: 28px;
    }

    .wave-label {
      width: 100px;
      font-family: var(--sc-font-mono);
      font-size: 11px;
      font-weight: bold;
      color: var(--sc-fg);
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .wave-canvas-wrap {
      flex: 1;
      height: 100%;
      position: relative;
    }

    .wave-svg {
      width: 100%;
      height: 100%;
    }

    /* Tests View */
    .tests-view {
      padding: 16px;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }

    .test-summary {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px;
      background: var(--sc-card-bg);
      border: 1px solid var(--sc-border);
      border-radius: 8px;
    }

    .test-suite-card {
      background: var(--sc-card-bg);
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      margin-bottom: 12px;
      overflow: hidden;
    }

    .suite-header {
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.04);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
    }

    .case-item {
      padding: 8px 14px;
      border-top: 1px solid var(--sc-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
    }

    .badge-pass {
      color: #34d399;
      background: rgba(52, 211, 153, 0.15);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: bold;
    }

    .badge-fail {
      color: #f87171;
      background: rgba(248, 113, 113, 0.15);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: bold;
    }

    /* IR View */
    .ir-view {
      padding: 16px;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .ir-pre {
      flex: 1;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--sc-border);
      border-radius: 8px;
      padding: 16px;
      font-family: var(--sc-font-mono);
      font-size: 11px;
      color: #a7f3d0;
      overflow: auto;
      white-space: pre-wrap;
    }

    /* Empty state */
    .empty-state {
      padding: 40px 20px;
      text-align: center;
      color: var(--sc-muted);
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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h5l4 6h7M4 18h5l4-6"/><circle cx="20" cy="12" r="2"/></svg>
        Circuit
        <span class="tab-badge" id="circuit-node-count">0</span>
      </button>
      <button class="tab-btn" data-tab="truth">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/></svg>
        Truth table
        <span class="tab-badge" id="truth-row-count">0</span>
      </button>
      <button class="tab-btn" data-tab="waveform">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-9 4 18 3-9h4"/></svg>
        Waveform
      </button>
      <button class="tab-btn" data-tab="tests">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2v7.31L4 19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2l-6-9.69V2h-4z"/></svg>
        Tests
        <span class="tab-badge" id="tests-count">0</span>
      </button>
      <button class="tab-btn" data-tab="ir">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
        { } IR
      </button>
    </div>

    <div class="top-actions">
      <select id="circuit-picker" class="circuit-select"></select>
      <button id="btn-reset" class="btn-action" title="Reset Simulation Inputs to 0">↺ Reset</button>
      <button id="btn-expand" class="btn-action" title="Open in Editor Beside">⤢ Expand</button>
      <div class="live-indicator">
        <span class="live-dot"></span>
        Live simulation
      </div>
    </div>
  </div>

  <!-- Content Container -->
  <div class="view-container">
    <!-- Empty / Welcome State -->
    <div id="empty-state" class="empty-state" style="display: none;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--sc-muted);"><path d="M4 6h5l4 6h7M4 18h5l4-6"/><circle cx="20" cy="12" r="2"/></svg>
      <h3>No LogicFlow file active</h3>
      <p>Open or focus a <code>.lf</code> file in the editor to start live circuit simulation.</p>
    </div>

    <!-- Circuit Tab Content -->
    <div id="tab-circuit" class="tab-content active">
      <!-- Simulator Dock -->
      <div class="sim-dock">
        <div class="sim-column">
          <div class="sim-col-header">
            <span>Inputs</span>
            <span id="input-count-badge">0</span>
          </div>
          <div id="inputs-list"></div>
        </div>
        <div class="sim-column">
          <div class="sim-col-header">
            <span>Outputs</span>
            <span id="output-count-badge">0</span>
          </div>
          <div id="outputs-list"></div>
        </div>
      </div>

      <!-- Evaluation Graph Section -->
      <div class="graph-section">
        <div class="graph-header">
          <div class="graph-title-group">
            <span>Evaluation graph</span>
            <strong id="graph-circuit-name">—</strong>
            <span id="graph-meta">—</span>
          </div>
          <div class="graph-legend">
            <div class="legend-item"><span class="legend-line high"></span> HIGH</div>
            <div class="legend-item"><span class="legend-line low"></span> LOW</div>
            <span id="graph-nodes-count" class="tab-badge">0 nodes</span>
            <span id="graph-layers-count" class="tab-badge">0 layers</span>
            <div class="zoom-toolbar">
              <button id="btn-zoom-in" class="zoom-btn" title="Zoom In">+</button>
              <button id="btn-zoom-out" class="zoom-btn" title="Zoom Out">−</button>
              <button id="btn-zoom-fit" class="zoom-btn" title="Reset View">⟲</button>
            </div>
          </div>
        </div>

        <div id="graph-viewport" class="graph-viewport">
          <div id="graph-world" class="graph-world">
            <svg id="graph-svg" class="graph-svg"></svg>
            <div id="graph-nodes-layer"></div>
          </div>
        </div>
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
    let zoomScale = 1.0;
    let panX = 40;
    let panY = 40;
    let isPanning = false;
    let startX = 0;
    let startY = 0;

    // Elements
    const emptyState = document.getElementById("empty-state");
    const diagBanner = document.getElementById("diagnostics-banner");
    const diagText = document.getElementById("diagnostics-text");
    const circuitPicker = document.getElementById("circuit-picker");
    const circuitNodeCount = document.getElementById("circuit-node-count");
    const truthRowCount = document.getElementById("truth-row-count");
    const testsCount = document.getElementById("tests-count");
    const inputsList = document.getElementById("inputs-list");
    const outputsList = document.getElementById("outputs-list");
    const inputCountBadge = document.getElementById("input-count-badge");
    const outputCountBadge = document.getElementById("output-count-badge");
    const graphCircuitName = document.getElementById("graph-circuit-name");
    const graphMeta = document.getElementById("graph-meta");
    const graphNodesCount = document.getElementById("graph-nodes-count");
    const graphLayersCount = document.getElementById("graph-layers-count");
    const graphViewport = document.getElementById("graph-viewport");
    const graphWorld = document.getElementById("graph-world");
    const graphSvg = document.getElementById("graph-svg");
    const graphNodesLayer = document.getElementById("graph-nodes-layer");
    const truthTableView = document.getElementById("truth-table-view");
    const waveformChart = document.getElementById("waveform-chart");
    const testsSummary = document.getElementById("tests-summary");
    const testsList = document.getElementById("tests-list");
    const irPre = document.getElementById("ir-pre");
    const btnReset = document.getElementById("btn-reset");
    const btnExpand = document.getElementById("btn-expand");

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
      vscode.postMessage({ type: "selectCircuit", name: e.target.value });
    });

    // Reset button
    btnReset.addEventListener("click", () => {
      vscode.postMessage({ type: "resetInputs" });
    });

    // Expand button
    btnExpand.addEventListener("click", () => {
      vscode.postMessage({ type: "expand" });
    });

    // Zoom and Pan
    document.getElementById("btn-zoom-in").addEventListener("click", () => {
      zoomScale = Math.min(zoomScale * 1.25, 2.5);
      applyTransform();
    });
    document.getElementById("btn-zoom-out").addEventListener("click", () => {
      zoomScale = Math.max(zoomScale / 1.25, 0.2);
      applyTransform();
    });
    document.getElementById("btn-zoom-fit").addEventListener("click", () => {
      fitGraph();
    });

    graphViewport.addEventListener("mousedown", (e) => {
      if (e.target.closest(".node-card")) return;
      isPanning = true;
      startX = e.clientX - panX;
      startY = e.clientY - panY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isPanning) return;
      panX = e.clientX - startX;
      panY = e.clientY - startY;
      applyTransform();
    });

    window.addEventListener("mouseup", () => {
      isPanning = false;
    });

    graphViewport.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoomScale = Math.min(Math.max(zoomScale * delta, 0.15), 2.5);
      applyTransform();
    }, { passive: false });

    function applyTransform() {
      graphWorld.style.transform = \`translate(\${panX}px, \${panY}px) scale(\${zoomScale})\`;
    }

    function fitGraph() {
      if (!model || !model.layout) return;
      const vw = graphViewport.clientWidth || 500;
      const vh = graphViewport.clientHeight || 400;
      const lw = model.layout.width || 600;
      const lh = model.layout.height || 400;
      const scaleX = (vw - 60) / lw;
      const scaleY = (vh - 60) / lh;
      zoomScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.3), 1.1);
      panX = Math.max(20, (vw - lw * zoomScale) / 2);
      panY = Math.max(20, (vh - lh * zoomScale) / 2);
      applyTransform();
    }

    function render(newModel) {
      model = newModel;
      if (!model || !model.circuits || model.circuits.length === 0) {
        emptyState.style.display = "flex";
        document.querySelectorAll(".tab-content").forEach(c => c.style.display = "none");
        return;
      }
      emptyState.style.display = "none";
      document.querySelectorAll(".tab-content").forEach(c => c.style.display = "");
      const currentTabEl = document.getElementById("tab-" + activeTab);
      if (currentTabEl) currentTabEl.classList.add("active");

      // Diagnostics banner
      if (model.diagnostics && model.diagnostics.length > 0) {
        const error = model.diagnostics.find(d => d.severity === "error") || model.diagnostics[0];
        diagBanner.style.display = "flex";
        diagText.textContent = \`Line \${error.line}: \${error.message}\`;
      } else {
        diagBanner.style.display = "none";
      }

      // Populate circuit picker
      circuitPicker.innerHTML = "";
      model.circuits.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = \`Circuit \${c.name}\`;
        if (c.name === model.activeCircuit) opt.selected = true;
        circuitPicker.appendChild(opt);
      });

      const activeCircuit = model.circuits.find(c => c.name === model.activeCircuit) || model.circuits[0];
      if (!activeCircuit) return;

      circuitNodeCount.textContent = activeCircuit.stats.nodes;
      graphCircuitName.textContent = activeCircuit.name;
      graphMeta.textContent = \`\${activeCircuit.stats.nodes} nodes • \${activeCircuit.stats.maxDepth} deep • \${activeCircuit.sequential ? "Sequential" : "Combinational"}\`;
      graphNodesCount.textContent = \`\${activeCircuit.stats.nodes} nodes\`;
      graphLayersCount.textContent = \`\${model.layout ? model.layout.depth : 0} layers\`;

      // Render Inputs
      renderInputs(activeCircuit);

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
        paths += \`<path d="\${SEGMENT_SHAPES[i]}" fill="\${on ? '#d1ff52' : 'rgba(255,255,255,0.06)'}" \${on ? 'filter="drop-shadow(0 0 2px #d1ff52)"' : ''}/>\`;
      }
      return \`<svg class="seven-seg-svg" viewBox="0 0 28 36" width="22" height="28">\${paths}</svg><span class="bus-decimal">#\${hexChar}</span>\`;
    }

    function renderInputs(circuit) {
      inputsList.innerHTML = "";
      inputCountBadge.textContent = circuit.inputs.length;
      circuit.inputs.forEach(inp => {
        let val = model.inputs[inp.name] || "0";
        if (inp.width > 1 && val.length < inp.width) {
          val = val.padStart(inp.width, "0");
        }
        const isHigh = val === "1" || parseInt(val, 2) > 0;

        const row = document.createElement("div");
        row.className = "sim-item";

        const labelGrp = document.createElement("div");
        labelGrp.className = "sim-label-group";
        labelGrp.innerHTML = \`<span class="sim-name">\${inp.name}</span><span class="sim-width">\${inp.width}b</span>\`;
        row.appendChild(labelGrp);

        const controlsGrp = document.createElement("div");
        controlsGrp.className = "sim-controls-group";

        if (inp.width === 1) {
          const sw = document.createElement("div");
          sw.className = "switch-btn" + (isHigh ? " high" : "");
          sw.innerHTML = \`<div class="switch-knob">\${isHigh ? "1" : "0"}</div>\`;
          sw.title = \`Toggle \${inp.name} (currently \${isHigh ? "1" : "0"})\`;
          sw.addEventListener("click", () => {
            vscode.postMessage({ type: "toggleInput", name: inp.name });
          });
          controlsGrp.appendChild(sw);
        } else {
          const busRow = document.createElement("div");
          busRow.className = "bus-row";

          const inpBox = document.createElement("input");
          inpBox.className = "bus-text-input";
          inpBox.value = val;
          inpBox.title = "Type binary (e.g. 100000), hex (0x20), or decimal";
          inpBox.addEventListener("change", (e) => {
            vscode.postMessage({ type: "setInput", name: inp.name, value: e.target.value });
          });
          inpBox.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              vscode.postMessage({ type: "setInput", name: inp.name, value: e.target.value });
              inpBox.blur();
            }
          });

          let decVal = "";
          try {
            decVal = BigInt("0b" + (val.replace(/[^01]/g, "") || "0")).toString(10);
          } catch {
            decVal = "0";
          }
          const decBadge = document.createElement("span");
          decBadge.className = "bus-decimal";
          decBadge.textContent = \`#\${decVal}\`;
          decBadge.title = \`Decimal: \${decVal}\`;

          busRow.appendChild(inpBox);
          busRow.appendChild(decBadge);
          controlsGrp.appendChild(busRow);

          if (inp.width <= 16) {
            const bitCells = document.createElement("div");
            bitCells.className = "bit-cells";
            for (let i = 0; i < inp.width; i++) {
              const bit = val[i] ?? "0";
              const bitIdx = inp.width - 1 - i;
              const cell = document.createElement("button");
              cell.className = "bit-cell" + (bit === "1" ? " is-on" : "");
              cell.textContent = bit;
              cell.title = \`\${inp.name}[\${bitIdx}] = \${bit}. Click to flip.\`;
              cell.addEventListener("click", () => {
                vscode.postMessage({ type: "flipBit", name: inp.name, bitIndex: bitIdx });
              });
              bitCells.appendChild(cell);
            }
            controlsGrp.appendChild(bitCells);
          }
        }

        row.appendChild(controlsGrp);
        inputsList.appendChild(row);
      });
    }

    function renderOutputs(circuit) {
      outputsList.innerHTML = "";
      outputCountBadge.textContent = circuit.outputs.length;
      circuit.outputs.forEach(out => {
        const snap = model.snapshot?.outputs?.[out.name];
        let val = snap?.binary || "0";
        if (out.width > 1 && val.length < out.width) {
          val = val.padStart(out.width, "0");
        }
        const isHigh = val === "1" || (parseInt(val, 2) || 0) > 0;
        const decVal = snap?.decimal ?? (() => {
          try { return BigInt("0b" + (val.replace(/[^01]/g, "") || "0")).toString(10); } catch { return "0"; }
        })();

        const row = document.createElement("div");
        row.className = "sim-item";

        const labelGrp = document.createElement("div");
        labelGrp.className = "sim-label-group";
        labelGrp.innerHTML = \`<span class="sim-name">\${out.name}</span><span class="sim-width">\${out.width}b</span>\`;
        row.appendChild(labelGrp);

        const outContainer = document.createElement("div");
        outContainer.className = "sim-output-container";

        if (out.width === 1) {
          const pill = document.createElement("div");
          pill.className = "output-pill" + (isHigh ? " high" : "");
          pill.textContent = isHigh ? "1" : "0";
          pill.title = \`\${out.name} is \${isHigh ? "HIGH (1)" : "LOW (0)"}\`;
          outContainer.appendChild(pill);
        } else {
          const mode = outputDisplayModes[out.name] || "number";

          const displayEl = document.createElement("div");
          displayEl.className = "output-display-el";

          if (mode === "number") {
            displayEl.innerHTML = \`<span class="display-bin">\${val}</span><span class="bus-decimal">#\${decVal}</span>\`;
          } else if (mode === "led") {
            const leds = document.createElement("div");
            leds.className = "display-leds";
            for (let i = 0; i < val.length; i++) {
              const led = document.createElement("span");
              led.className = "led-dot" + (val[i] === "1" ? " on" : "");
              leds.appendChild(led);
            }
            displayEl.appendChild(leds);
          } else if (mode === "seven") {
            displayEl.innerHTML = renderSevenSegment(val);
          } else if (mode === "bar") {
            const max = (1n << BigInt(out.width)) - 1n;
            const cur = BigInt(decVal || 0);
            const pct = max > 0n ? Math.min(100, Math.round(Number((cur * 100n) / max))) : 0;
            displayEl.innerHTML = \`<div class="bar-track"><div class="bar-fill" style="width:\${pct}%"></div></div><span class="bus-decimal">#\${decVal}</span>\`;
          }

          outContainer.appendChild(displayEl);

          const modeSelect = document.createElement("select");
          modeSelect.className = "display-mode-select";
          [
            { id: "number", label: "Number" },
            { id: "led", label: "LEDs" },
            { id: "seven", label: "7-Seg" },
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
          outContainer.appendChild(modeSelect);
        }

        row.appendChild(outContainer);
        outputsList.appendChild(row);
      });
    }

    function renderGraph() {
      if (!model.layout) return;
      const layout = model.layout;
      graphSvg.setAttribute("width", layout.width);
      graphSvg.setAttribute("height", layout.height);
      graphWorld.style.width = layout.width + "px";
      graphWorld.style.height = layout.height + "px";

      // Render wires
      let svgHtml = "";
      layout.edges.forEach(edge => {
        const fromVal = model.snapshot?.nodes?.[edge.from] || (model.inputs[edge.from] ?? "0");
        const isHigh = fromVal === "1" || parseInt(fromVal, 2) > 0;
        svgHtml += \`<path d="\${edge.path}" class="wire \${isHigh ? "wire-high" : "wire-low"}"></path>\`;
      });
      graphSvg.innerHTML = svgHtml;

      // Render nodes
      graphNodesLayer.innerHTML = "";
      layout.nodes.forEach(node => {
        const card = document.createElement("div");
        card.className = "node-card";
        card.style.left = node.x + "px";
        card.style.top = node.y + "px";
        card.style.width = node.w + "px";
        card.style.height = node.h + "px";

        const val = node.kind === "input" 
          ? (model.inputs[node.label] ?? "0")
          : (model.snapshot?.nodes?.[node.id] ?? "0");
        const isHigh = val === "1" || parseInt(val, 2) > 0;

        card.innerHTML = \`
          <div class="node-header">
            <div class="node-op-badge">
              <span class="node-glyph">\${node.opGlyph}</span>
              <span>\${node.op || node.kind.toUpperCase()}</span>
            </div>
            <span class="node-val \${isHigh ? "high" : ""}">\${val}</span>
          </div>
          <div class="node-label" title="\${node.label}">\${node.displayLabel}</div>
          <div class="node-sub">\${node.subLabel}</div>
        \`;
        graphNodesLayer.appendChild(card);
      });
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
      tt.inputs.forEach(i => html += \`<th>\${i.name}</th>\`);
      tt.outputs.forEach(o => html += \`<th>\${o.name}</th>\`);
      html += '</tr></thead><tbody>';

      tt.rows.forEach(row => {
        // Check if row matches current inputs
        let isMatch = true;
        tt.inputs.forEach(i => {
          if (row.input[i.name] !== (model.inputs[i.name] || "0")) isMatch = false;
        });

        html += \`<tr class="\${isMatch ? "active-row" : ""}">\`;
        tt.inputs.forEach(i => html += \`<td>\${row.input[i.name]}</td>\`);
        tt.outputs.forEach(o => html += \`<td>\${row.output[o.name]}</td>\`);
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
      let html = \`<div style="font-size: 11px; color: var(--sc-muted); margin-bottom: 12px;">\${wf.timeSteps.length} simulated steps</div>\`;

      const allSignals = [
        ...wf.inputNames.map(n => ({ name: n, isInput: true })),
        ...wf.outputNames.map(n => ({ name: n, isInput: false }))
      ];

      allSignals.forEach(sig => {
        html += \`
          <div class="wave-row">
            <div class="wave-label">\${sig.name} <span class="tab-badge">\${sig.isInput ? "in" : "out"}</span></div>
            <div class="wave-canvas-wrap">
              <svg class="wave-svg" viewBox="0 0 \${wf.timeSteps.length * 30} 24" preserveAspectRatio="none">
        \`;

        let path = "";
        wf.timeSteps.forEach((step, idx) => {
          const val = sig.isInput ? step.inputs[sig.name] : step.outputs[sig.name];
          const isHigh = val === "1" || parseInt(val, 2) > 0;
          const y = isHigh ? 3 : 21;
          const x = idx * 30;
          if (idx === 0) {
            path += \`M \${x} \${y} L \${x + 30} \${y}\`;
          } else {
            path += \` L \${x} \${y} L \${x + 30} \${y}\`;
          }
        });

        html += \`
                <path d="\${path}" fill="none" stroke="var(--sc-lime)" stroke-width="2" />
              </svg>
            </div>
          </div>
        \`;
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
      testsSummary.innerHTML = \`
        <span><strong>Status:</strong> \${t.ok ? '<span class="badge-pass">ALL TESTS PASSED</span>' : '<span class="badge-fail">TESTS FAILED</span>'}</span>
        <span>Passed: <strong>\${t.passed}</strong></span>
        <span>Failed: <strong>\${t.failed}</strong></span>
      \`;

      let html = "";
      t.suites.forEach(suite => {
        html += \`
          <div class="test-suite-card">
            <div class="suite-header">
              <span>\${suite.name}</span>
              <span class="\${suite.pass ? "badge-pass" : "badge-fail"}">\${suite.pass ? "PASS" : "FAIL"}</span>
            </div>
        \`;
        suite.cases.forEach(c => {
          html += \`
            <div class="case-item">
              <span>\${c.label}</span>
              <span class="\${c.pass ? "badge-pass" : "badge-fail"}">\${c.pass ? "PASS" : "FAIL"}</span>
            </div>
          \`;
        });
        html += '</div>';
      });
      testsList.innerHTML = html;
    }

    // Message listener from extension
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "update") {
        render(msg.payload);
      } else if (msg.type === "setTab") {
        const btn = document.querySelector(\`.tab-btn[data-tab="\${msg.tab}"]\`);
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
