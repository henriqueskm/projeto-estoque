"use client";

import { useEffect } from "react";

type DocumentOverflowSnapshot = {
  body: string;
  documentElement: string;
};

const activeScrollLocks = new Set<symbol>();
let overflowSnapshot: DocumentOverflowSnapshot | null = null;

function acquireDocumentScrollLock() {
  const lockId = Symbol("document-scroll-lock");

  if (activeScrollLocks.size === 0) {
    overflowSnapshot = {
      body: document.body.style.overflow,
      documentElement: document.documentElement.style.overflow,
    };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
  }

  activeScrollLocks.add(lockId);

  return () => {
    if (!activeScrollLocks.delete(lockId) || activeScrollLocks.size > 0) {
      return;
    }

    document.body.style.overflow = overflowSnapshot?.body ?? "";
    document.documentElement.style.overflow =
      overflowSnapshot?.documentElement ?? "";
    overflowSnapshot = null;
  };
}

export function useDocumentScrollLock(isLocked = true) {
  useEffect(() => {
    if (!isLocked) {
      return;
    }

    return acquireDocumentScrollLock();
  }, [isLocked]);
}
