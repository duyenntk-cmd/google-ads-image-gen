"use client";
import { useMemo, useSyncExternalStore } from "react";
import { loadConnection, onConnectionChange, type MktConnection } from "./mktClient";

function snapshot(): string {
  const conn = loadConnection();
  return conn ? JSON.stringify(conn) : "";
}

/** Current MKT System connection (from sessionStorage), re-rendering on connect/disconnect. */
export function useMktConnection(): MktConnection | null {
  const raw = useSyncExternalStore(onConnectionChange, snapshot, () => "");
  return useMemo(() => (raw ? (JSON.parse(raw) as MktConnection) : null), [raw]);
}
