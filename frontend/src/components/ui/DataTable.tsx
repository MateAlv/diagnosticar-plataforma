"use client";

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

export type DataRecord = Record<string, unknown>;

type DataTableProps = {
  columns: string[];
  rows: DataRecord[];
};

export function DataTable({ columns, rows }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const columnDefs = useMemo<ColumnDef<DataRecord>[]>(() => {
    return columns.map((col) => ({
      id: col,
      accessorKey: col,
      header: col,
      cell: (ctx) => {
        const value = ctx.getValue();
        if (value === null || value === undefined || value === "") {
          return "—";
        }
        if (typeof value === "number") {
          return Number.isInteger(value) ? value : Number(value.toFixed(4));
        }
        if (typeof value === "string") {
          return value.length > 80 ? `${value.slice(0, 80)}…` : value;
        }
        return String(value);
      },
    }));
  }, [columns]);

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="lu-table-wrapper">
      <table className="lu-table">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const isSortable = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <th key={header.id}>
                    <button
                      type="button"
                      className="lu-table-sort"
                      onClick={header.column.getToggleSortingHandler()}
                      disabled={!isSortable}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIndicator direction={sortDir} />
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td className="lu-table-empty" colSpan={columns.length || 1}>
                Sin registros para mostrar.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (!direction) return <span className="lu-table-sort-icon">⇅</span>;
  if (direction === "asc") return <span className="lu-table-sort-icon">↑</span>;
  return <span className="lu-table-sort-icon">↓</span>;
}
