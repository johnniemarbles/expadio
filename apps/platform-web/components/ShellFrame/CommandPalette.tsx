"use client";
import React, { useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSection } from "../../lib/contracts";
import styles from "./CommandPalette.module.css";

export interface CommandItem {
  readonly id: string;
  readonly label: string;
  readonly short?: string;
  readonly group?: string;
  readonly description?: string;
  readonly href?: string;
  readonly onSelect?: () => void;
}

export interface SearchProvider {
  readonly id: string;
  readonly label: string;
  readonly search: (query: string) => Promise<readonly CommandItem[]> | readonly CommandItem[];
}

interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly sections: readonly WorkspaceSection[];
  readonly contextQuery?: string;
  readonly providers?: readonly SearchProvider[];
}

export function CommandPalette({
  isOpen,
  onClose,
  sections,
  contextQuery = "",
  providers = [],
}: CommandPaletteProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const defaultNavigationItems: readonly CommandItem[] = useMemo(() => {
    return sections.map((s) => ({
      id: s.id,
      label: s.label,
      short: s.short,
      group: s.group ?? "Workspace",
      href: s.href + (contextQuery && s.href !== "/" ? contextQuery : ""),
    }));
  }, [sections, contextQuery]);

  const [providerItems, setProviderItems] = useState<readonly CommandItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    const query = search.trim().toLowerCase();
    if (providers.length === 0) {
      setProviderItems([]);
      return;
    }

    let active = true;
    Promise.all(providers.map((p) => p.search(query))).then((results) => {
      if (active) {
        setProviderItems(results.flat());
      }
    });

    return () => {
      active = false;
    };
  }, [isOpen, search, providers]);

  const allItems: readonly CommandItem[] = useMemo(() => {
    const query = search.trim().toLowerCase();
    const navFiltered = !query
      ? defaultNavigationItems
      : defaultNavigationItems.filter(
          (s) =>
            s.label.toLowerCase().includes(query) ||
            (s.group && s.group.toLowerCase().includes(query)) ||
            (s.href && s.href.toLowerCase().includes(query))
        );
    return [...navFiltered, ...providerItems];
  }, [defaultNavigationItems, providerItems, search]);

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
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, allItems.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + allItems.length) % Math.max(1, allItems.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = allItems[selectedIndex];
        if (selected) {
          if (selected.onSelect) {
            selected.onSelect();
          } else if (selected.href) {
            router.push(selected.href);
          }
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, allItems, selectedIndex, router, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchHeader}>
          <span className={styles.searchIcon} aria-hidden="true">
            🔍
          </span>
          <input
            ref={inputRef}
            type="text"
            className={styles.input}
            placeholder="Type a command, route, or search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-autocomplete="list"
          />
          <kbd className={styles.escBadge}>ESC</kbd>
        </div>
        <div className={styles.resultsList} role="listbox">
          {allItems.length === 0 ? (
            <div className={styles.emptyState}>No matching results found.</div>
          ) : (
            allItems.map((item, idx) => (
              <button
                key={item.id + item.label}
                type="button"
                className={[styles.item, idx === selectedIndex ? styles.itemSelected : ""].join(" ")}
                onClick={() => {
                  if (item.onSelect) {
                    item.onSelect();
                  } else if (item.href) {
                    router.push(item.href);
                  }
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                role="option"
                aria-selected={idx === selectedIndex}
              >
                <div className={styles.itemLeft}>
                  <span className={styles.itemIcon} aria-hidden="true">
                    {item.short || "❖"}
                  </span>
                  <div>
                    <span>{item.label}</span>
                    {item.description && (
                      <span style={{ display: "block", fontSize: "11px", color: "var(--theme-text-muted)" }}>
                        {item.description}
                      </span>
                    )}
                  </div>
                </div>
                <span className={styles.itemGroupTag}>{item.group || "Workspace"}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
