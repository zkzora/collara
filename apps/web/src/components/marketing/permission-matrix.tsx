import { permissionMatrixView, type PermissionMatrixView } from "@collara/domain";
import { cn } from "@/lib/utils";
import { TableRegion, tbody, th } from "./docs-ui";

type Cell = PermissionMatrixView["rows"][number]["cells"][number];

/**
 * Renders a matrix cell. Meaning never relies on colour alone: glyphs are hidden from assistive
 * technology and replaced by text ("No access", "Permitted").
 */
function MatrixCell({ cell }: { cell: Cell }) {
  const notEnforced = cell.access !== "DENIED" && !cell.enforced;
  if (cell.access === "DENIED" && cell.text === "—") {
    return (
      <>
        <span aria-hidden="true" className="text-fg-faint">
          —
        </span>
        <span className="sr-only">No access</span>
      </>
    );
  }
  const permitted = cell.text.startsWith("✓");
  const rest = permitted ? cell.text.slice(1).trim() : cell.text;
  return (
    <span className={cn(notEnforced ? "text-fg-subtle" : permitted ? "text-fg" : "text-fg-muted")}>
      {permitted ? (
        <>
          <span aria-hidden="true">✓</span>
          <span className="sr-only">Permitted</span>
          {rest ? ` ${rest}` : null}
        </>
      ) : (
        rest
      )}
      {notEnforced ? (
        <>
          <span aria-hidden="true">*</span>
          <span className="sr-only"> (specified, not enforced in this build)</span>
        </>
      ) : null}
    </span>
  );
}

/** /docs#roles matrix, from the same typed policy the API and the UI mock enforce (CR-21). */
export function PermissionMatrix() {
  const view = permissionMatrixView();
  return (
    <div className="flex flex-col gap-2.5">
      <TableRegion label="Permission matrix" minWidth="min-w-[1180px]">
        <caption className="sr-only">Permission matrix: actions and data by role</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(th, "sticky left-0 z-10 bg-surface-page")}>
              Data / action
            </th>
            {view.columns.map((column) => (
              <th key={column.key} scope="col" className={cn(th, "px-2.5 text-center")}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={tbody}>
          {view.rows.map((row) => (
            <tr key={row.action}>
              <th
                scope="row"
                className="sticky left-0 z-10 w-[260px] bg-surface-page px-3.5 py-2.5 align-top text-[14px] font-normal text-fg"
              >
                {row.label}
              </th>
              {row.cells.map((cell) => (
                <td key={cell.column} className="px-2.5 py-2.5 text-center align-top text-[12.5px] leading-[1.5]">
                  <MatrixCell cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableRegion>
      <p className="text-[13px] leading-[1.6] text-fg-subtle">
        ✓ permitted within the participant&apos;s case scope · Other entries name the scope that applies; “—” means no
        access · * specified but not enforced in this build, so it is treated as no access. Equipment evidence and
        financing terms are separate records, so their recipients can differ. Privacy depends on the implemented
        contract model and the deployment; the hosting provider&apos;s access and trust model must also be considered.
      </p>
    </div>
  );
}
