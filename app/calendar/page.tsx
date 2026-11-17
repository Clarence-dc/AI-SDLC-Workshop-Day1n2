"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Holiday, Todo } from "@/lib/db";
import {
  calendarMonth,
  formatSingaporeDate,
  generateCalendarGrid,
  shiftMonth,
  singaporeDay,
} from "@/lib/timezone";
export default function Calendar() {
  const router = useRouter();
  const [month, setMonth] = useState(""),
    [todos, setTodos] = useState<Todo[]>([]),
    [holidays, setHolidays] = useState<Holiday[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const update = () =>
      setMonth(
        calendarMonth(new URLSearchParams(location.search).get("month")),
      );
    update();
    window.addEventListener("popstate", update);
    Promise.all(
      ["/api/todos", "/api/holidays"].map(async (p) => {
        const r = await fetch(p);
        if (!r.ok) throw new Error("Unable to load the calendar");
        return r.json();
      }),
    )
      .then(([t, h]) => {
        setTodos(t);
        setHolidays(h);
      })
      .catch((e) => setError(e.message));
    return () => window.removeEventListener("popstate", update);
  }, []);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  function navigate(value: string) {
    const next = calendarMonth(value);
    setMonth(next);
    history.pushState(null, "", `/calendar?month=${next}`);
  }
  const grid = month
    ? generateCalendarGrid(+month.slice(0, 4), +month.slice(5, 7))
    : [];
  const dayTodos = (date: string) =>
    todos.filter((t) => t.due_date && singaporeDay(t.due_date) === date);
  return (
    <div className="calendar-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          ◒ daylight
        </Link>
        <Link href="/">← Back to tasks</Link>
        <button
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            router.replace("/login");
            router.refresh();
          }}
        >
          Sign out
        </button>
      </header>
      <main>
        <p className="eyebrow">SEE THE BIGGER PICTURE</p>
        <div className="row between calendar-heading">
          <div>
            <h1>
              A little <em>perspective.</em>
            </h1>
            <p className="muted">
              Your plans, with room to breathe. All dates in Singapore.
            </p>
          </div>
          <div className="row">
            <button
              aria-label="Previous month"
              disabled={!month}
              onClick={() => navigate(shiftMonth(month, -1))}
            >
              ←
            </button>
            <button onClick={() => navigate(singaporeDay().slice(0, 7))}>
              Today
            </button>
            <button
              aria-label="Next month"
              disabled={!month}
              onClick={() => navigate(shiftMonth(month, 1))}
            >
              →
            </button>
          </div>
        </div>
        <h2>
          {month &&
            formatSingaporeDate(`${month}-01T00:00:00`, {
              dateStyle: undefined,
              timeStyle: undefined,
              year: "numeric",
              month: "long",
            })}
        </h2>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="calendar-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="weekday">
              {d}
            </div>
          ))}
          {grid.map((day) => {
            const items = dayTodos(day.date),
              holiday = holidays.find((h) => h.date === day.date);
            return (
              <button
                key={day.date}
                aria-label={day.date}
                className={`calendar-cell ${!day.isCurrentMonth ? "outside" : ""} ${day.isToday ? "today" : ""} ${day.isPast ? "past" : ""} ${day.isWeekend ? "weekend" : ""}`}
                onClick={() => setSelected(day.date)}
              >
                <span className="day-number">{day.day}</span>
                {holiday && <span className="holiday">{holiday.name}</span>}
                {items.slice(0, 3).map((t) => (
                  <span
                    key={t.id}
                    className={`calendar-task badge ${t.priority} ${t.completed ? "strike" : ""}`}
                  >
                    {t.title}
                  </span>
                ))}
                {items.length > 3 && (
                  <span className="small">+{items.length - 3} more</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="row calendar-legend">
          <span className="badge high">High priority</span>
          <span className="badge medium">Medium priority</span>
          <span className="badge low">Low priority</span>
          <span className="muted small">
            Singapore public holidays shown when seeded
          </span>
        </div>
      </main>
      <dialog
        ref={dialog}
        className="modal"
        aria-labelledby="day-details-heading"
        onCancel={() => setSelected(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        <div className="modal-heading">
          <h2 id="day-details-heading">
            {selected &&
              formatSingaporeDate(selected, {
                dateStyle: "full",
                timeStyle: undefined,
              })}
          </h2>
          <button aria-label="Close dialog" onClick={() => setSelected(null)}>
            ×
          </button>
        </div>
        {holidays
          .filter((h) => h.date === selected)
          .map((h) => (
            <p className="holiday" key={h.id}>
              {h.name}
            </p>
          ))}
        {selected &&
          dayTodos(selected).map((t) => (
            <div className="manager-row" key={t.id}>
              <span className={`badge ${t.priority}`}>{t.priority}</span>
              <strong className={t.completed ? "strike" : ""}>{t.title}</strong>
              <span>
                {t.completed
                  ? "Complete"
                  : t.due_date && formatSingaporeDate(t.due_date)}
              </span>
            </div>
          ))}
        {selected && dayTodos(selected).length === 0 && (
          <p className="muted">Nothing planned. A little room for yourself.</p>
        )}
      </dialog>
    </div>
  );
}
