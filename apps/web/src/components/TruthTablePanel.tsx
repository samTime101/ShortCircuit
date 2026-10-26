import { memo } from "react";
import type { TruthTable } from "@shortcircuit/engine";
import { AlertTriangle, Table } from "./Icons";

interface TruthTablePanelProps {
  table: TruthTable | null;
}

function Bits({ value }: { value: string }) {
  return (
    <span className="tt-bits">
      {value.split("").map((bit, index) => (
        <span className={bit === "1" ? "bit-one" : "bit-zero"} key={index}>
          {bit}
        </span>
      ))}
    </span>
  );
}

export const TruthTablePanel = memo(function TruthTablePanel({ table }: TruthTablePanelProps) {
  if (!table) {
    return (
      <div className="workbench-empty">
        <Table size={24} />
        <h3>No truth table yet</h3>
        <p>Compile a combinational circuit to enumerate every input combination.</p>
      </div>
    );
  }

  return (
    <div className="truth-panel">
      <div className="panel-intro">
        <div>
          <span className="eyebrow">Exhaustive behavior</span>
          <h2>Truth table</h2>
          <p>
            Every input bit is enumerated. Bus inputs are treated as groups of bits, and outputs use the
            circuit's declared widths.
          </p>
        </div>
        <div className="stat-cluster">
          <div className="stat-card">
            <span>Input bits</span>
            <strong>{table.inputBits}</strong>
          </div>
          <div className="stat-card">
            <span>Rows</span>
            <strong>{table.rows.length > 0 ? table.rows.length : "—"}</strong>
          </div>
          <div className="stat-card">
            <span>Outputs</span>
            <strong>{table.outputs.length}</strong>
          </div>
        </div>
      </div>

      {table.reason ? (
        <div className="notice warning">
          <AlertTriangle size={15} />
          <span>{table.reason}</span>
        </div>
      ) : null}

      {table.rows.length > 0 ? (
        <>
          <div className="truth-table-wrap">
            <table className="truth-table">
              <thead>
                <tr>
                  <th className="row-index">#</th>
                  {table.inputs.map((input) => (
                    <th key={input.name} className="input-col">
                      <span>{input.name}</span>
                      <small>{input.width}b in</small>
                    </th>
                  ))}
                  {table.outputs.map((output) => (
                    <th key={output.name} className="output-col">
                      <span>{output.name}</span>
                      <small>{output.width}b out</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index}>
                    <td className="row-index">{index}</td>
                    {table.inputs.map((input) => (
                      <td key={input.name}>
                        <Bits value={row.input[input.name] ?? ""} />
                      </td>
                    ))}
                    {table.outputs.map((output) => (
                      <td
                        key={output.name}
                        className={row.output[output.name]?.includes("1") ? "hot-cell" : ""}
                      >
                        <Bits value={row.output[output.name] ?? ""} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="truth-footnote">
            <span>
              {table.rows.length} exhaustive row{table.rows.length === 1 ? "" : "s"} · {table.outputs.length}{" "}
              output{table.outputs.length === 1 ? "" : "s"} evaluated on the compiled IR
            </span>
            {table.truncated ? <span className="truth-cap">enumeration capped</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
});
