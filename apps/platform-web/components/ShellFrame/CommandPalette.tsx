"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSection } from "../../lib/contracts";
import styles from "./CommandPalette.module.css";

interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sections: readonly WorkspaceSection[];
  readonly contextQuery?: string;
}

export function CommandPalette({ isOpen, onClose, sections, contextQuery = "" }: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredSections = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return sections;
    return sections.filter(
      (s) =>
        s.label.toLowerCase().includes(query) ||
        (s.group && s.group.toLowerCase().includes(query)) ||
        s.href.toLowerCase().includes(query)
    );
  }, [sections, search]);

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredSections.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredSections.length) % Math.max(1, filteredSections.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filteredSections[selectedIndex]) {
          const target = filteredSections[selectedIndex];
          const url = target.href + (contextQuery && target.href !== "/" ? contextQuery : "");
          router.push(url);
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredSections, selectedIndex, router, onClose, contextQuery]);

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={onClose} role="dialog" aria-modal="true" aria-label="Command Palette">
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <span className={styles.searchIcon} aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Type a command or jump to page..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-autocomplete="list"
          />
          <kbd className={styles.escBadge}>ESC</kbd>
        </div>
        <div className={styles.resultsList} role="listbox">
          {filteredSections.length === 0 ? (
            <div className={styles.emptyState}>No matching pages or commands found.</div>
          ) : (
            filteredSections.map((section, idx) => (
              <button
                key={section.href + section.label}
                type="button"
                className={[styles.item, idx === selectedIndex ? styles.itemSelected : ""].join(" ")}
                onClick={() => {
                  const url = section.href + (contextQuery && section.href !== "/" ? contextQuery : "");
                  router.push(url);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                role="option"
                aria-selected={idx === selectedIndex}
              >
                <div className={styles.itemLeft}>
                  <span className={styles.itemIcon} aria-hidden="true">
                    {section.short || "❖"}
                  </span>
                  <span>{section.label}</span>
                </div>
                <span className={styles.itemGroupTag}>{section.group || "Workspace"}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
