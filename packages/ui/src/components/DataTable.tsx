"use client";
import React, { useState, useMemo } from "react";
import styles from "./DataTable.module.css";
import { EmptyState } from "./EmptyState";

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render?: ((row: T) => React.ReactNode) | undefined;
  readonly sortable?: boolean | undefined;
  readonly width?: string | undefined;
}

export interface DataTableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly data: readonly T[];
  readonly keyExtractor: (row: T) => string;
  readonly loading?: boolean | undefined;
  readonly searchPlaceholder?: string | undefined;
  readonly emptyTitle?: string | undefined;
  readonly emptyDescription?: string | undefined;
  readonly emptyActionLabel?: string | undefined;
  readonly onEmptyAction?: (() => void) | undefined;
  readonly pageSize?: number | undefined;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyExtractor,
  loading = false,
  searchPlaceholder,
  emptyTitle = "No data found",
  emptyDescription = "No records are available to display.",
  emptyActionLabel,
  onEmptyAction,
  pageSize = 10,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const filteredData = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((row) =>
      Object.values(row).some(
        (val) =>
          val !== null &&
          val !== undefined &&
          String(val).toLowerCase().includes(q)
      )
    );
  }, [data, search]);

  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData;
    return [...filteredData].sort((a, b) => {
      const valA = a[sortKey];
      const valB = b[sortKey];
      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      const res = String(valA).localeCompare(String(valB), undefined, {
        numeric: true,
      });
      return sortOrder === "asc" ? res : -res;
    });
  }, [filteredData, sortKey, sortOrder]);

  const totalPages = Math.ceil(sortedData.length / pageSize);
  const paginatedData = sortedData.slice(page * pageSize, (page + 1) * pageSize);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  return (
    <div className={styles.tableWrapper}>
      {searchPlaceholder && (
        <div className={styles.toolbar}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
          <span style={{ fontSize: "12px", color: "var(--theme-text-muted)" }}>
            {sortedData.length} records
          </span>
        </div>
      )}
      {loading ? (
        <table className={styles.table}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={styles.th} style={c.width ? { width: c.width } : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((r) => (
              <tr key={r} className={styles.tr}>
                {columns.map((c) => (
                  <td key={c.key} className={styles.td}>
                    <div
                      className={styles.skeletonCell}
                      style={{ width: "60%" }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : paginatedData.length === 0 ? (
        <div style={{ padding: "24px" }}>
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            primaryAction={
              emptyActionLabel && onEmptyAction
                ? { label: emptyActionLabel, onClick: onEmptyAction }
                : undefined
            }
          />
        </div>
      ) : (
        <>
          <table className={styles.table}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={[styles.th, c.sortable ? styles.sortableTh : ""].join(" ")}
                    style={c.width ? { width: c.width } : undefined}
                    onClick={() => c.sortable && handleSort(c.key)}
                  >
                    {c.header}
                    {c.sortable && sortKey === c.key && (
                      <span style={{ marginLeft: "4px" }}>
                        {sortOrder === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginatedData.map((row) => (
                <tr key={keyExtractor(row)} className={styles.tr}>
                  {columns.map((c) => (
                    <td key={c.key} className={styles.td}>
                      {c.render ? c.render(row) : String(row[c.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div className={styles.pagination}>
              <span>
                Page {page + 1} of {totalPages}
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className={styles.pageBtn}
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
