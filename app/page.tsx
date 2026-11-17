"use client";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import type {
  Todo,
  Tag,
  Template,
  Priority,
  RecurrencePattern,
  ReminderMinutes,
} from "@/lib/db";
import {
  formatSingaporeDate,
  getSingaporeNow,
  parseSingaporeDate,
  singaporeISO,
} from "@/lib/timezone";
import {
  applyFilters,
  calculateProgress,
  defaultFilters,
  hasActiveFilters,
  sectionTodos,
  type FilterState,
} from "@/lib/todos";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { parseTemplateSubtasks } from "@/lib/validation";
type Draft = {
  title: string;
  priority: Priority;
  due_date: string;
  is_recurring: boolean;
  recurrence_pattern: RecurrencePattern;
  reminder_minutes: string;
};
type Preset = {
  id: string;
  name: string;
  filters: FilterState;
  createdAt: string;
};
const emptyDraft: Draft = {
  title: "",
  priority: "medium",
  due_date: "",
  is_recurring: false,
  recurrence_pattern: "daily",
  reminder_minutes: "",
};
const reminderOptions = [
  [15, "15m"],
  [30, "30m"],
  [60, "1h"],
  [120, "2h"],
  [1440, "1d"],
  [2880, "2d"],
  [10080, "1w"],
] as const;
const presetKey = "todo-app:filter-presets";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api/${path}`, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) {
    if (r.status === 401) window.location.reload();
    throw new Error(data.error || "Request failed");
  }
  return data;
}
function draftFrom(t: Todo): Draft {
  return {
    title: t.title,
    priority: t.priority,
    due_date: t.due_date
      ? singaporeISO(parseSingaporeDate(t.due_date)).slice(0, 16)
      : "",
    is_recurring: t.is_recurring,
    recurrence_pattern: t.recurrence_pattern || "daily",
    reminder_minutes: String(t.reminder_minutes ?? ""),
  };
}
function draftBody(d: Draft) {
  if (!d.title.trim()) throw new Error("Title cannot be empty");
  if (
    d.due_date &&
    parseSingaporeDate(d.due_date).getTime() <
      getSingaporeNow().getTime() + 60000
  )
    throw new Error(
      "Due date must be at least 1 minute in the future (Singapore time)",
    );
  if (d.is_recurring && !d.due_date)
    throw new Error("Recurring todos require a due date");
  return {
    title: d.title.trim(),
    priority: d.priority,
    due_date: d.due_date || null,
    is_recurring: d.is_recurring,
    recurrence_pattern: d.is_recurring ? d.recurrence_pattern : null,
    reminder_minutes:
      d.due_date && d.reminder_minutes
        ? (+d.reminder_minutes as ReminderMinutes)
        : null,
  };
}
function DraftFields({
  draft,
  setDraft,
  hideDueDate = false,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  hideDueDate?: boolean;
}) {
  return (
    <div className="draft-options">
      <label>
        Priority
        <select
          aria-label="Priority"
          value={draft.priority}
          onChange={(e) =>
            setDraft({ ...draft, priority: e.target.value as Priority })
          }
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      {!hideDueDate && (
        <label>
          Due date · Singapore
          <input
            aria-label="Due date"
            type="datetime-local"
            value={draft.due_date}
            onChange={(e) =>
              setDraft({
                ...draft,
                due_date: e.target.value,
                reminder_minutes: e.target.value ? draft.reminder_minutes : "",
              })
            }
          />
        </label>
      )}
      <label>
        Reminder
        <select
          aria-label="Reminder"
          disabled={!draft.due_date}
          value={draft.reminder_minutes}
          onChange={(e) =>
            setDraft({ ...draft, reminder_minutes: e.target.value })
          }
        >
          <option value="">None</option>
          {reminderOptions.map(([v, l]) => (
            <option key={v} value={v}>
              {l} before
            </option>
          ))}
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={draft.is_recurring}
          onChange={(e) =>
            setDraft({ ...draft, is_recurring: e.target.checked })
          }
        />
        Repeat
      </label>
      {draft.is_recurring && (
        <label>
          Every
          <select
            aria-label="Recurrence"
            value={draft.recurrence_pattern}
            onChange={(e) =>
              setDraft({
                ...draft,
                recurrence_pattern: e.target.value as RecurrencePattern,
              })
            }
          >
            {["daily", "weekly", "monthly", "yearly"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
function Modal({
  title,
  close,
  children,
  error,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={headingId}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-heading">
        <h2 id={headingId}>{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </div>
      {error && (
        <p role="alert" className="banner error">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
export default function Home() {
  const router = useRouter();
  const [todos, setTodos] = useState<Todo[]>([]),
    [tags, setTags] = useState<Tag[]>([]),
    [templates, setTemplates] = useState<Template[]>([]),
    [username, setUsername] = useState("");
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft),
    [showOptions, setShowOptions] = useState(false),
    [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [filters, setFilters] = useState(defaultFilters),
    [search, setSearch] = useState(""),
    [advanced, setAdvanced] = useState(false),
    [presets, setPresets] = useState<Preset[]>([]),
    [presetName, setPresetName] = useState(""),
    [savePresetOpen, setSavePresetOpen] = useState(false);
  const [modal, setModal] = useState<"tags" | "templates" | null>(null),
    [editing, setEditing] = useState<Todo | null>(null),
    [editDraft, setEditDraft] = useState<Draft>(emptyDraft),
    [editTagIds, setEditTagIds] = useState<number[]>([]),
    [expanded, setExpanded] = useState<number[]>([]),
    [subtaskTitles, setSubtaskTitles] = useState<Record<number, string>>({}),
    [editingSubtask, setEditingSubtask] = useState<{
      id: number;
      title: string;
    } | null>(null);
  const [tagDraft, setTagDraft] = useState({ name: "", color: "#3B82F6" }),
    [tagEditing, setTagEditing] = useState<number | null>(null);
  const [templateSource, setTemplateSource] = useState<Todo | null>(null),
    [templateName, setTemplateName] = useState(""),
    [templateCategory, setTemplateCategory] = useState(""),
    [templateOffset, setTemplateOffset] = useState(""),
    [templateEditing, setTemplateEditing] = useState<Template | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { permission, enable } = useNotifications();
  const refresh = useCallback(async () => {
    const [ts, gs, ps] = await Promise.all([
      api<Todo[]>("todos"),
      api<Tag[]>("tags"),
      api<Template[]>("templates"),
    ]);
    setTodos(ts);
    setTags(gs);
    setTemplates(ps);
  }, []);
  useEffect(() => {
    void Promise.all([
      refresh(),
      api<{ username: string }>("auth/me").then((s) => setUsername(s.username)),
    ])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    setNow(getSingaporeNow().getTime());
    const timer = setInterval(() => setNow(getSingaporeNow().getTime()), 30000);
    try {
      const data = JSON.parse(localStorage.getItem(presetKey) || "[]");
      if (Array.isArray(data))
        setPresets(
          data.filter(
            (p) =>
              typeof p.id === "string" &&
              typeof p.name === "string" &&
              p.filters &&
              Object.keys(defaultFilters).every(
                (k) => typeof p.filters[k] === "string",
              ),
          ),
        );
    } catch {
      /* Ignore corrupt saved preferences. */
    }
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((f) => ({ ...f, search })),
      search ? 300 : 0,
    );
    return () => clearTimeout(timer);
  }, [search]);
  const sections = useMemo(
    () => sectionTodos(applyFilters(todos, filters), now),
    [todos, filters, now],
  );
  async function action(work: () => Promise<unknown>) {
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }
  async function createTodo(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await action(async () => {
      const data = draftBody(draft);
      const tempId = -Date.now();
      const optimistic: Todo = {
        ...data,
        completed: false,
        id: tempId,
        user_id: 0,
        last_notification_sent: null,
        created_at: singaporeISO(),
        updated_at: null,
        subtasks: [],
        tags: tags.filter((t) => selectedTags.includes(t.id)),
      };
      setTodos((ts) => [optimistic, ...ts]);
      try {
        const todo = await api<Todo>("todos", "POST", data);
        for (const tag_id of selectedTags)
          await api(`todos/${todo.id}/tags`, "POST", { tag_id });
        setDraft(emptyDraft);
        setSelectedTags([]);
        setShowOptions(false);
        await refresh();
      } catch (e) {
        setTodos((ts) => ts.filter((t) => t.id !== tempId));
        throw e;
      }
    });
    setBusy(false);
  }
  async function mutateTodo(t: Todo, method: "PUT" | "DELETE", body?: unknown) {
    const previous = todos;
    setTodos((ts) =>
      method === "DELETE"
        ? ts.filter((x) => x.id !== t.id)
        : ts.map((x) => (x.id === t.id ? { ...x, ...(body as object) } : x)),
    );
    try {
      await api(`todos/${t.id}`, method, body);
      await refresh();
    } catch (e) {
      setTodos(previous);
      throw e;
    }
  }
  function clearFilters() {
    setSearch("");
    setFilters(defaultFilters);
  }
  function persistPresets(next: Preset[]) {
    localStorage.setItem(presetKey, JSON.stringify(next));
    setPresets(next);
  }
  async function saveTemplate() {
    await action(async () => {
      if (templateEditing) {
        await api(`templates/${templateEditing.id}`, "PUT", {
          ...templateEditing,
          name: templateName,
          category: templateCategory || null,
          due_date_offset_minutes: templateOffset ? +templateOffset : null,
        });
      } else if (templateSource) {
        await api("templates", "POST", {
          name: templateName,
          title_template: templateSource.title,
          priority: templateSource.priority,
          is_recurring: templateSource.is_recurring,
          recurrence_pattern: templateSource.recurrence_pattern,
          reminder_minutes: templateSource.reminder_minutes,
          due_date_offset_minutes: templateOffset ? +templateOffset : null,
          category: templateCategory || null,
          subtasks_json: JSON.stringify(
            templateSource.subtasks.map((s) => ({
              title: s.title,
              position: s.position,
            })),
          ),
        });
      }
      await refresh();
      setTemplateSource(null);
      setTemplateEditing(null);
      setNotice("Template saved");
    });
  }
  async function addPasskey() {
    await action(async () => {
      const options = await api<
        Parameters<typeof startRegistration>[0]["optionsJSON"]
      >("auth/register-options", "POST", { username });
      const response = await startRegistration({ optionsJSON: options });
      await api("auth/register-verify", "POST", response);
      setNotice("Another passkey added");
    });
  }
  const active = hasActiveFilters(filters),
    done = todos.filter((t) => t.completed).length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          ◒ daylight<span>TODO</span>
        </Link>
        <p className="sidebar-label">YOUR WORKSPACE</p>
        <nav>
          <Link className="nav-item selected" href="/">
            ▤ <span>All tasks</span>
            <span className="nav-count">{todos.length}</span>
          </Link>
          <Link className="nav-item" href="/calendar">
            ▦ <span>Calendar</span>
          </Link>
          <button className="nav-item" onClick={() => setModal("templates")}>
            ▧ <span>Templates</span>
            <span className="nav-count">{templates.length}</span>
          </button>
        </nav>
        <div className="sidebar-tags">
          <div className="row between">
            <p className="sidebar-label">YOUR TAGS</p>
            <button aria-label="Manage Tags" onClick={() => setModal("tags")}>
              ＋
            </button>
          </div>
          {tags.map((t) => (
            <button
              key={t.id}
              className="tag-nav"
              onClick={() =>
                setFilters({
                  ...filters,
                  tagId: filters.tagId === String(t.id) ? "all" : String(t.id),
                })
              }
            >
              <i style={{ background: t.color }} />
              {t.name}
            </button>
          ))}
          {!tags.length && (
            <p className="muted small">Give your tasks a little context.</p>
          )}
        </div>
        <div className="sidebar-footer">
          <div className="avatar">
            {username.slice(0, 1).toUpperCase() || "D"}
          </div>
          <div>
            <strong>{username || "Your workspace"}</strong>
            <small>Asia / Singapore</small>
          </div>
          <button
            aria-label="Sign out"
            title="Sign out"
            onClick={() =>
              void action(async () => {
                await api("auth/logout", "POST");
                router.replace("/login");
                router.refresh();
              })
            }
          >
            ↪
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="muted">/</span> All tasks
          </span>
          <div className="row">
            <button
              onClick={() => void enable()}
              disabled={
                permission === "granted" || permission === "unsupported"
              }
            >
              {permission === "granted"
                ? "♧ Notifications on"
                : permission === "unsupported"
                  ? "Notifications unavailable"
                  : "♧ Enable Notifications"}
            </button>
            <details className="menu">
              <summary>Data & account ⋯</summary>
              <div>
                <a download href="/api/todos/export?format=json">
                  Export JSON
                </a>
                <a download href="/api/todos/export?format=csv">
                  Export CSV
                </a>
                <button onClick={() => fileRef.current?.click()}>
                  Import JSON
                </button>
                <button onClick={() => void addPasskey()}>Add a passkey</button>
              </div>
            </details>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Import JSON file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void action(async () => {
                    if (file.size > 5_000_000)
                      throw new Error("File too large (maximum 5 MB)");
                    let payload;
                    try {
                      payload = JSON.parse(await file.text());
                    } catch {
                      throw new Error("Invalid JSON format");
                    }
                    const result = await api<{ message: string }>(
                      "todos/import",
                      "POST",
                      payload,
                    );
                    await refresh();
                    setNotice(result.message);
                  });
                e.target.value = "";
              }}
            />
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {now
                  ? formatSingaporeDate(singaporeISO(), {
                      dateStyle: "full",
                      timeStyle: undefined,
                    })
                  : "YOUR DAY, A LITTLE CLEARER"}
              </p>
              <h1>
                A little more <em>focus.</em>
              </h1>
              <p className="muted">
                A place for everything on your mind. One task at a time.
              </p>
            </div>
            <div className="completion">
              <span>
                {done}
                <small> / {todos.length}</small>
              </span>
              <p>tasks complete</p>
            </div>
          </div>
          {error && (
            <div role="alert" className="banner error">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="banner success">
              {notice}
              <button
                aria-label="Dismiss message"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          <form className="composer" onSubmit={createTodo}>
            <div className="composer-main">
              <span className="add-symbol">＋</span>
              <input
                aria-label="Task title"
                placeholder="What would you like to get done?"
                value={draft.title}
                maxLength={500}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                required
              />
              <button className="primary" disabled={busy || loading}>
                Add task <span>↵</span>
              </button>
            </div>
            <div className="composer-toolbar">
              <button
                type="button"
                onClick={() => setShowOptions(!showOptions)}
              >
                {showOptions ? "− Hide details" : "＋ Add details"}
              </button>
              {templates.length > 0 && (
                <select
                  aria-label="Use a template"
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      void action(async () => {
                        await api(`templates/${e.target.value}/use`, "POST");
                        await refresh();
                      });
                  }}
                >
                  <option value="">▧ Use a template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="muted small">Small steps. Good progress.</span>
            </div>
            {showOptions && (
              <>
                <DraftFields draft={draft} setDraft={setDraft} />
                {tags.length > 0 && (
                  <div className="tag-selector">
                    {tags.map((t) => (
                      <label key={t.id}>
                        <input
                          type="checkbox"
                          checked={selectedTags.includes(t.id)}
                          onChange={(e) =>
                            setSelectedTags(
                              e.target.checked
                                ? [...selectedTags, t.id]
                                : selectedTags.filter((id) => id !== t.id),
                            )
                          }
                        />
                        <span>{t.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            )}
          </form>
          <div className="filters">
            <div className="search">
              <span>⌕</span>
              <input
                aria-label="Search tasks"
                placeholder="Search tasks or subtasks…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  aria-label="Clear search"
                  onClick={() => {
                    setSearch("");
                    setFilters({ ...filters, search: "" });
                  }}
                >
                  ×
                </button>
              )}
            </div>
            <select
              aria-label="Filter priority"
              value={filters.priority}
              onChange={(e) =>
                setFilters({ ...filters, priority: e.target.value })
              }
            >
              <option value="all">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
            {tags.length > 0 && (
              <select
                aria-label="Filter tag"
                value={filters.tagId}
                onChange={(e) =>
                  setFilters({ ...filters, tagId: e.target.value })
                }
              >
                <option value="all">All Tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className={advanced ? "active" : ""}
              onClick={() => setAdvanced(!advanced)}
            >
              ☷ Advanced
            </button>
          </div>
          {advanced && (
            <div className="advanced">
              <label>
                Status
                <select
                  aria-label="Completion status"
                  value={filters.completion}
                  onChange={(e) =>
                    setFilters({ ...filters, completion: e.target.value })
                  }
                >
                  <option value="all">All tasks</option>
                  <option value="incomplete">Incomplete</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <label>
                From
                <input
                  aria-label="Due date from"
                  type="date"
                  value={filters.dueDateFrom}
                  onChange={(e) =>
                    setFilters({ ...filters, dueDateFrom: e.target.value })
                  }
                />
              </label>
              <label>
                To
                <input
                  aria-label="Due date to"
                  type="date"
                  value={filters.dueDateTo}
                  onChange={(e) =>
                    setFilters({ ...filters, dueDateTo: e.target.value })
                  }
                />
              </label>
            </div>
          )}
          {(active || presets.length > 0) && (
            <div className="presets">
              {presets.map((p) => (
                <span key={p.id}>
                  <button
                    onClick={() => {
                      setFilters(p.filters);
                      setSearch(p.filters.search);
                    }}
                  >
                    {p.name}
                  </button>
                  <button
                    aria-label={`Delete preset ${p.name}`}
                    onClick={() =>
                      void action(async () =>
                        persistPresets(presets.filter((x) => x.id !== p.id)),
                      )
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
              {active && (
                <>
                  <button
                    onClick={() => {
                      setPresetName("");
                      setSavePresetOpen(true);
                    }}
                  >
                    Save Filter
                  </button>
                  <button onClick={clearFilters}>Clear All</button>
                </>
              )}
            </div>
          )}
          {loading ? (
            <div className="empty">Getting your day ready…</div>
          ) : Object.values(sections).every((s) => s.length === 0) ? (
            <div className="empty">
              <span>☀</span>
              <h2>
                {todos.length
                  ? "No matching tasks"
                  : "A little space to begin."}
              </h2>
              <p>
                {todos.length
                  ? "Try another search or clear your filters."
                  : "Add your first task above. The rest can wait."}
              </p>
              {active && <button onClick={clearFilters}>Clear All</button>}
            </div>
          ) : (
            Object.entries(sections).map(
              ([name, items]) =>
                items.length > 0 && (
                  <section className="task-section" key={name}>
                    <div className="section-heading">
                      <h2>
                        <i className={`section-dot ${name.toLowerCase()}`} />
                        {name} <span>{items.length}</span>
                      </h2>
                      <small>
                        {name === "Overdue"
                          ? "A little attention needed"
                          : name === "Pending"
                            ? "Room to make progress"
                            : "Look how far you’ve come"}
                      </small>
                    </div>
                    <div className="task-list">
                      {items.map((t) => {
                        const progress = calculateProgress(t.subtasks);
                        const open = expanded.includes(t.id);
                        return (
                          <article
                            className={`task-card ${t.completed ? "completed" : ""}`}
                            key={t.id}
                            data-testid="todo-card"
                          >
                            <div className="task-top">
                              <input
                                type="checkbox"
                                aria-label={`Complete ${t.title}`}
                                checked={t.completed}
                                disabled={t.id < 0}
                                onChange={() =>
                                  void action(() =>
                                    mutateTodo(t, "PUT", {
                                      completed: !t.completed,
                                    }),
                                  )
                                }
                              />
                              <div className="task-body">
                                <h3>{t.title}</h3>
                                <div className="task-meta">
                                  <span className={`badge ${t.priority}`}>
                                    {t.priority}
                                  </span>
                                  {t.due_date && (
                                    <span
                                      className={
                                        name === "Overdue" ? "overdue-text" : ""
                                      }
                                    >
                                      ◷ {formatSingaporeDate(t.due_date)}
                                    </span>
                                  )}
                                  {t.is_recurring && (
                                    <span className="badge recurring">
                                      ↻ {t.recurrence_pattern}
                                    </span>
                                  )}
                                  {t.reminder_minutes && (
                                    <span>
                                      ♧{" "}
                                      {
                                        reminderOptions.find(
                                          ([v]) => v === t.reminder_minutes,
                                        )?.[1]
                                      }
                                    </span>
                                  )}
                                  {t.tags.map((tag) => (
                                    <span
                                      className="tag-pill"
                                      key={tag.id}
                                      style={{
                                        background: tag.color,
                                        color: tagText(tag.color),
                                      }}
                                    >
                                      {tag.name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="task-actions">
                                <button
                                  aria-label={`Edit ${t.title}`}
                                  onClick={() => {
                                    setError("");
                                    setEditing(t);
                                    setEditTagIds(t.tags.map((tag) => tag.id));
                                    setEditDraft(draftFrom(t));
                                  }}
                                >
                                  Edit
                                </button>
                                <button
                                  aria-label={`Save ${t.title} as template`}
                                  onClick={() => {
                                    setTemplateSource(t);
                                    setTemplateEditing(null);
                                    setTemplateName(t.title);
                                    setTemplateCategory("");
                                    setTemplateOffset(
                                      t.due_date
                                        ? String(
                                            Math.max(
                                              2,
                                              Math.round(
                                                (parseSingaporeDate(
                                                  t.due_date,
                                                ).getTime() -
                                                  getSingaporeNow().getTime()) /
                                                  60000,
                                              ),
                                            ),
                                          )
                                        : "",
                                    );
                                  }}
                                >
                                  ▧
                                </button>
                                <button
                                  aria-label={`Delete ${t.title}`}
                                  onClick={() =>
                                    void action(() => mutateTodo(t, "DELETE"))
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                            {progress.total > 0 && (
                              <div className="progress-wrap">
                                <div
                                  className="progress"
                                  role="progressbar"
                                  aria-label={`${t.title} subtask progress`}
                                  aria-valuenow={progress.percent}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                >
                                  <div
                                    style={{
                                      width: `${progress.percent}%`,
                                      background:
                                        progress.percent === 100
                                          ? "#15803d"
                                          : "#3b82f6",
                                    }}
                                  />
                                </div>
                                <span>
                                  {progress.completed}/{progress.total} subtasks
                                </span>
                              </div>
                            )}
                            <div className="task-bottom">
                              <button
                                aria-label="Subtasks"
                                aria-expanded={open}
                                onClick={() =>
                                  setExpanded(
                                    open
                                      ? expanded.filter((id) => id !== t.id)
                                      : [...expanded, t.id],
                                  )
                                }
                              >
                                {open ? "⌄" : "›"} Subtasks
                              </button>
                              <span className="muted small">
                                {t.id < 0 ? "Saving…" : `#${t.id}`}
                              </span>
                            </div>
                            {open && (
                              <div className="subtasks">
                                {t.subtasks.map((s) => (
                                  <div key={s.id} className="subtask">
                                    <input
                                      type="checkbox"
                                      checked={s.completed}
                                      aria-label={`Complete subtask ${s.title}`}
                                      onChange={() =>
                                        void action(async () => {
                                          setTodos((ts) =>
                                            ts.map((x) =>
                                              x.id === t.id
                                                ? {
                                                    ...x,
                                                    subtasks: x.subtasks.map(
                                                      (y) =>
                                                        y.id === s.id
                                                          ? {
                                                              ...y,
                                                              completed:
                                                                !y.completed,
                                                            }
                                                          : y,
                                                    ),
                                                  }
                                                : x,
                                            ),
                                          );
                                          try {
                                            await api(
                                              `subtasks/${s.id}`,
                                              "PUT",
                                              { completed: !s.completed },
                                            );
                                          } finally {
                                            await refresh();
                                          }
                                        })
                                      }
                                    />
                                    <span
                                      className={s.completed ? "strike" : ""}
                                    >
                                      {s.title}
                                    </span>
                                    <button
                                      aria-label={`Edit subtask ${s.title}`}
                                      onClick={() =>
                                        setEditingSubtask({
                                          id: s.id,
                                          title: s.title,
                                        })
                                      }
                                    >
                                      Edit
                                    </button>
                                    <button
                                      aria-label={`Delete subtask ${s.title}`}
                                      onClick={() =>
                                        void action(async () => {
                                          await api(
                                            `subtasks/${s.id}`,
                                            "DELETE",
                                          );
                                          await refresh();
                                        })
                                      }
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    void action(async () => {
                                      const title = subtaskTitles[t.id]?.trim();
                                      if (!title)
                                        throw new Error(
                                          "Subtask title cannot be empty",
                                        );
                                      await api(
                                        `todos/${t.id}/subtasks`,
                                        "POST",
                                        { title },
                                      );
                                      setSubtaskTitles({
                                        ...subtaskTitles,
                                        [t.id]: "",
                                      });
                                      await refresh();
                                    });
                                  }}
                                >
                                  <input
                                    aria-label={`New subtask for ${t.title}`}
                                    placeholder="Add a small step…"
                                    value={subtaskTitles[t.id] || ""}
                                    onChange={(e) =>
                                      setSubtaskTitles({
                                        ...subtaskTitles,
                                        [t.id]: e.target.value,
                                      })
                                    }
                                  />
                                  <button>Add</button>
                                </form>
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                ),
            )
          )}
          <footer className="content-footer">
            <span>◒ A clear mind starts with a little daylight.</span>
            <span>All times in Singapore</span>
          </footer>
        </div>
      </main>
      {editing && (
        <Modal error={error} title="Edit task" close={() => setEditing(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const original = draftFrom(editing);
                const data =
                  editDraft.due_date === original.due_date
                    ? {
                        ...draftBody({
                          ...editDraft,
                          due_date: "",
                          is_recurring: false,
                          reminder_minutes: "",
                        }),
                        due_date: editing.due_date,
                        is_recurring: editDraft.is_recurring,
                        recurrence_pattern: editDraft.is_recurring
                          ? editDraft.recurrence_pattern
                          : null,
                        reminder_minutes: editDraft.reminder_minutes
                          ? +editDraft.reminder_minutes
                          : null,
                      }
                    : draftBody(editDraft);
                await mutateTodo(editing, "PUT", data);
                for (const tag of tags) {
                  const had = editing.tags.some((t) => t.id === tag.id),
                    has = editTagIds.includes(tag.id);
                  if (had !== has)
                    await api(
                      `todos/${editing.id}/tags`,
                      has ? "POST" : "DELETE",
                      { tag_id: tag.id },
                    );
                }
                await refresh();
                setEditing(null);
              });
            }}
          >
            <label>
              Task title
              <input
                autoFocus
                required
                value={editDraft.title}
                onChange={(e) =>
                  setEditDraft({ ...editDraft, title: e.target.value })
                }
              />
            </label>
            <DraftFields draft={editDraft} setDraft={setEditDraft} />
            <fieldset>
              <legend>Tags</legend>
              {tags.map((tag) => (
                <label className="check-label" key={tag.id}>
                  <input
                    type="checkbox"
                    checked={editTagIds.includes(tag.id)}
                    onChange={(e) =>
                      setEditTagIds(
                        e.target.checked
                          ? [...editTagIds, tag.id]
                          : editTagIds.filter((id) => id !== tag.id),
                      )
                    }
                  />
                  {tag.name}
                </label>
              ))}
            </fieldset>
            <div className="modal-footer">
              <button type="button" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="primary">Save changes</button>
            </div>
          </form>
        </Modal>
      )}
      {editingSubtask && (
        <Modal
          error={error}
          title="Edit subtask"
          close={() => setEditingSubtask(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(`subtasks/${editingSubtask.id}`, "PUT", {
                  title: editingSubtask.title,
                });
                await refresh();
                setEditingSubtask(null);
              });
            }}
          >
            <label>
              Subtask title
              <input
                required
                value={editingSubtask.title}
                onChange={(e) =>
                  setEditingSubtask({
                    ...editingSubtask,
                    title: e.target.value,
                  })
                }
              />
            </label>
            <button className="primary">Save subtask</button>
          </form>
        </Modal>
      )}
      {modal === "tags" && (
        <Modal
          error={error}
          title="Manage Tags"
          close={() => {
            setModal(null);
            setTagEditing(null);
            setTagDraft({ name: "", color: "#3B82F6" });
          }}
        >
          <p className="muted">A little color to keep things organized.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                await api(
                  tagEditing ? `tags/${tagEditing}` : "tags",
                  tagEditing ? "PUT" : "POST",
                  tagDraft,
                );
                setTagEditing(null);
                setTagDraft({ name: "", color: "#3B82F6" });
                await refresh();
              });
            }}
            className="tag-form"
          >
            <label>
              Tag name
              <input
                required
                aria-label="Tag name"
                value={tagDraft.name}
                onChange={(e) =>
                  setTagDraft({ ...tagDraft, name: e.target.value })
                }
              />
            </label>
            <label>
              Color
              <input
                aria-label="Tag color"
                type="color"
                value={tagDraft.color}
                onChange={(e) =>
                  setTagDraft({ ...tagDraft, color: e.target.value })
                }
              />
            </label>
            <button className="primary">
              {tagEditing ? "Save tag" : "Create tag"}
            </button>
          </form>
          {tags.map((t) => (
            <div className="manager-row" key={t.id}>
              <span
                className="tag-pill"
                style={{ background: t.color, color: tagText(t.color) }}
              >
                {t.name}
              </span>
              <button
                onClick={() => {
                  setTagEditing(t.id);
                  setTagDraft({ name: t.name, color: t.color });
                }}
              >
                Edit
              </button>
              <button
                aria-label={`Delete tag ${t.name}`}
                onClick={() =>
                  void action(async () => {
                    await api(`tags/${t.id}`, "DELETE");
                    await refresh();
                  })
                }
              >
                Delete
              </button>
            </div>
          ))}
        </Modal>
      )}
      {modal === "templates" && (
        <Modal
          error={error}
          title="Your templates"
          close={() => setModal(null)}
        >
          <p className="muted">
            Good routines deserve a shortcut. Save any task as a template using
            ▧.
          </p>
          {!templates.length && <p>No templates yet.</p>}
          {templates.map((t) => (
            <div className="manager-row" key={t.id}>
              <div>
                <strong>{t.name}</strong>
                <small>
                  {t.category || "Uncategorized"} · {t.priority}
                </small>
              </div>
              <button
                onClick={() =>
                  void action(async () => {
                    await api(`templates/${t.id}/use`, "POST");
                    await refresh();
                    setModal(null);
                  })
                }
              >
                Use
              </button>
              <button
                onClick={() => {
                  setModal(null);
                  setTemplateEditing(t);
                  setTemplateName(t.name);
                  setTemplateCategory(t.category || "");
                  setTemplateOffset(String(t.due_date_offset_minutes ?? ""));
                }}
              >
                Edit
              </button>
              <button
                aria-label={`Delete template ${t.name}`}
                onClick={() =>
                  void action(async () => {
                    await api(`templates/${t.id}`, "DELETE");
                    await refresh();
                  })
                }
              >
                Delete
              </button>
            </div>
          ))}
        </Modal>
      )}
      {(templateSource || templateEditing) && (
        <Modal
          error={error}
          title={templateEditing ? "Edit template" : "Save as template"}
          close={() => {
            setTemplateSource(null);
            setTemplateEditing(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveTemplate();
            }}
          >
            <label>
              Template name
              <input
                required
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </label>
            <label>
              Category
              <input
                value={templateCategory}
                onChange={(e) => setTemplateCategory(e.target.value)}
              />
            </label>
            <label>
              Due date offset (minutes after use)
              <input
                type="number"
                min={2}
                value={templateOffset}
                onChange={(e) => setTemplateOffset(e.target.value)}
                placeholder="No due date"
              />
            </label>
            {templateEditing && (
              <>
                <label>
                  Task title
                  <input
                    required
                    value={templateEditing.title_template}
                    onChange={(e) =>
                      setTemplateEditing({
                        ...templateEditing,
                        title_template: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Description
                  <input
                    value={templateEditing.description || ""}
                    onChange={(e) =>
                      setTemplateEditing({
                        ...templateEditing,
                        description: e.target.value,
                      })
                    }
                  />
                </label>
                <DraftFields
                  hideDueDate
                  draft={{
                    title: templateEditing.title_template,
                    priority: templateEditing.priority,
                    due_date: templateOffset ? "relative" : "",
                    is_recurring: templateEditing.is_recurring,
                    recurrence_pattern:
                      templateEditing.recurrence_pattern || "daily",
                    reminder_minutes: String(
                      templateEditing.reminder_minutes ?? "",
                    ),
                  }}
                  setDraft={(d) =>
                    setTemplateEditing({
                      ...templateEditing,
                      priority: d.priority,
                      is_recurring: d.is_recurring,
                      recurrence_pattern: d.is_recurring
                        ? d.recurrence_pattern
                        : null,
                      reminder_minutes: d.reminder_minutes
                        ? +d.reminder_minutes
                        : null,
                    })
                  }
                />
                <label>
                  Subtasks (one per line)
                  <textarea
                    rows={4}
                    value={parseTemplateSubtasks(templateEditing.subtasks_json)
                      .map((s: { title: string }) => s.title)
                      .join("\n")}
                    onChange={(e) =>
                      setTemplateEditing({
                        ...templateEditing,
                        subtasks_json: JSON.stringify(
                          e.target.value
                            .split("\n")
                            .filter(Boolean)
                            .map((title, position) => ({ title, position })),
                        ),
                      })
                    }
                  />
                </label>
              </>
            )}
            <p className="muted small">
              Keeps task settings and subtasks. Tags and concrete due dates are
              excluded. Recurrence and reminders require an offset.
            </p>
            <button className="primary">Save template</button>
          </form>
        </Modal>
      )}
      {savePresetOpen && (
        <Modal
          error={error}
          title="Save Filter"
          close={() => setSavePresetOpen(false)}
        >
          <p className="muted">
            {Object.entries(filters)
              .filter(([, v]) => v && v !== "all")
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                persistPresets([
                  ...presets,
                  {
                    id: crypto.randomUUID(),
                    name: presetName.trim(),
                    filters,
                    createdAt: singaporeISO(),
                  },
                ]);
                setSavePresetOpen(false);
              });
            }}
          >
            <label>
              Preset name
              <input
                required
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
            </label>
            <button className="primary">Save preset</button>
          </form>
        </Modal>
      )}
      {(modal ||
        editing ||
        templateSource ||
        templateEditing ||
        savePresetOpen) &&
        error && (
          <div role="alert" className="floating-error">
            {error}
            <button onClick={() => setError("")}>×</button>
          </div>
        )}
    </div>
  );
}
function tagText(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const s = parseInt(v, 16) / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#111827"
    : "#ffffff";
}
