"use client";
import { useCallback, useEffect, useState } from "react";
import type { Todo } from "../db";
export function useNotifications() {
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  useEffect(() => {
    setPermission(
      "Notification" in window ? Notification.permission : "unsupported",
    );
  }, []);
  const enable = useCallback(async () => {
    if ("Notification" in window)
      setPermission(await Notification.requestPermission());
  }, []);
  useEffect(() => {
    if (permission !== "granted") return;
    let stopped = false,
      active = false;
    const check = async () => {
      if (active || stopped) return;
      active = true;
      try {
        const r = await fetch("/api/notifications/check", {
          cache: "no-store",
        });
        if (!r.ok) return;
        const data = await r.json();
        if (!stopped)
          for (const todo of data.todos as Todo[])
            new Notification("Todo reminder", {
              body: todo.title,
              tag: `todo-${todo.id}-${todo.due_date}-${todo.reminder_minutes}`,
            });
      } catch {
        /* Retry on the next poll after transient network failures. */
      } finally {
        active = false;
      }
    };
    void check();
    const timer = setInterval(check, 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [permission]);
  return { permission, enable };
}
