"use client";

import { useEffect } from "react";
import styles from "./page.module.css";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.panel} style={{ padding: 40, textAlign: "center" }}>
      <h2 style={{ margin: "0 0 10px" }}>Something went wrong</h2>
      <p style={{ color: "var(--ink-600)", fontSize: 12, marginBottom: 20 }}>
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p style={{ color: "var(--ink-500)", fontSize: 10, marginBottom: 20 }}>
          Correlation ID: {error.digest}
        </p>
      )}
      <button 
        onClick={() => reset()}
        style={{
          background: "var(--brand)",
          color: "white",
          border: "none",
          padding: "8px 16px",
          borderRadius: 6,
          fontWeight: 600,
          cursor: "pointer"
        }}
      >
        Try again
      </button>
    </div>
  );
}
