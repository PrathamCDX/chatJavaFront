"use client";

import { useEffect } from "react";
import { deleteMessageHistory } from "@/lib/chat-state";

/** Runs once when the app loads in the browser, on every page. */
export default function StartupTasks() {
  useEffect(() => {
    deleteMessageHistory();
  }, []);

  return null;
}
