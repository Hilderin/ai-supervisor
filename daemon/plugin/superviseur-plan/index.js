/**
 * SuperviseurPlan
 * -----------------------------------------------------------------------------
 * Plugin OpenCode v2 migrated from OpenCodeTodoList (the source repository is
 * no longer referenced), renamed plan-* (the plan of a task is a sequence of
 * steps, distinct from its objectives) and extended with a dedicated
 * per-number update tool.
 *
 * Plan for a session, in three tools:
 *
 *   - `planwrite`  create or replace the whole list (numbered items),
 *   - `planupdate` update items BY NUMBER (one or several at once, transactional):
 *                  status change or retitle without rewriting the whole list,
 *   - `planread`   read the current list back.
 *
 * Plus, like the source plugin:
 *   - per-session persistence through `ctx.storage` (durable plugin KV store),
 *   - re-injection of the open plan items before every model request via
 *     `ctx.session.hook("context")`, so the list survives compaction.
 *
 * Dependency-free ESM on purpose: OpenCode loads the file as-is, with no build
 * and no dependency resolution. The plugin API is verified against
 * @opencode/plugin 2.0.x:
 *   - `ctx.tool.transform(editor => editor.add({ name, description, input, options, execute }))`
 *   - tool `options: { codemode: false, permission: "..." }` (direct tool)
 *   - `execute(input, context)` with `context.sessionID`
 *   - `ctx.storage.get/set`
 *   - `ctx.session.hook("context", async event => event.system.push({ type: "text", text }))`
 */

/** Storage keys are namespaced per session inside the plugin's own store. */
const STORAGE_PREFIX = "session/"

/** Upper bound on the plan items rendered into the model context, to bound tokens. */
const MAX_INJECTED = 50

const STATUSES = ["pending", "in_progress", "completed"]
const PRIORITIES = ["high", "medium", "low"]

const STATUS_SET = new Set(STATUSES)
const PRIORITY_SET = new Set(PRIORITIES)

/** Checkbox used when rendering the plan as text. */
const box = (status) => (status === "completed" ? "x" : status === "in_progress" ? "~" : " ")

/** Render the plan as compact markdown-ish text, items numbered from 1. */
const render = (todos) => {
  if (todos.length === 0) return "(no plan)"
  return todos
    .map((todo, i) => `${i + 1}. [${box(todo.status)}] (${todo.priority}) ${todo.content}`)
    .join("\n")
}

/**
 * Coerce whatever the model sent into a clean, complete plan list. Unknown
 * statuses/priorities fall back to safe defaults instead of rejecting the call,
 * because a partially valid list is more useful than a tool error.
 */
const normalize = (raw) => {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item) => item && typeof item === "object" && typeof item.content === "string" && item.content.trim() !== "")
    .map((item) => ({
      content: item.content.trim(),
      status: STATUS_SET.has(item.status) ? item.status : "pending",
      priority: PRIORITY_SET.has(item.priority) ? item.priority : "medium",
    }))
}

const PLAN_ITEM_SCHEMA = {
  type: "object",
  properties: {
    num: {
      type: "number",
      minimum: 1,
      description: "Position of the item in the current list (1-based), as shown by the numbered list.",
    },
    status: {
      type: "string",
      enum: STATUSES,
      description: "pending (not started), in_progress (current), completed (done).",
    },
    content: {
      type: "string",
      description: "Optional retitle of the item (imperative description).",
    },
    priority: {
      type: "string",
      enum: PRIORITIES,
      description: "high, medium, or low.",
    },
  },
  required: ["num"],
  additionalProperties: false,
}

const PLANWRITE_DESCRIPTION = [
  "Create or replace the session plan. Items are numbered (1, 2, ...) and the numbering is what `planupdate` relies on.",
  "Use it to plan multi-step work and to keep the list current: call it again with the full list whenever the plan changes.",
  "Prefer several small, concrete items; there is no limit on the number of items.",
  "On every change you may replace the whole list with `planwrite`, or update single items by number with `planupdate`.",
].join(" ")

const PLANUPDATE_DESCRIPTION = [
  "Update one or several plan items BY NUMBER, without rewriting the whole list.",
  "Each update is `{ num, status?, content?, priority? }`: num is the 1-based position shown on the numbered list.",
  "The status is validated strictly (pending, in_progress, completed) and every num must exist; if one update is invalid, nothing is applied.",
  "Use it to mark an item in_progress or completed, ideally right when you start or finish it. Use `planwrite` only when the plan itself changes.",
].join(" ")

const PLANREAD_DESCRIPTION =
  "Read the current session plan (numbered). Call it when you are unsure what remains, especially after a long gap or a compaction."

/** The plugin entrypoint. A plain { id, setup } is enough. */
export default {
  id: "superviseur-plan",

  async setup(ctx) {
    const key = (sessionID) => STORAGE_PREFIX + sessionID

    /** Read the list for one session from the plugin's durable storage. */
    const read = async (sessionID) => normalize(await ctx.storage.get(key(sessionID)))

    /** Persist the list for one session. */
    const write = async (sessionID, todos) => {
      await ctx.storage.set(key(sessionID), todos)
    }

    /**
     * Apply a batch of updates BY NUMBER. Returns { todos, errors }; when any
     * update is invalid the returned todos are the list WITHOUT the batch
     * applied (transactional: the caller writes only if errors is empty).
     */
    const applyUpdates = (todos, rawUpdates) => {
      const errors = []
      const updates = Array.isArray(rawUpdates) ? rawUpdates : []
      if (updates.length === 0) {
        errors.push("no updates: pass at least one { num, status } object")
        return { todos, errors }
      }
      const next = todos.map((todo) => ({ ...todo }))
      for (const update of updates) {
        if (!update || typeof update !== "object") {
          errors.push("each update must be an object { num, status?, content?, priority? }")
          continue
        }
        const num = Number(update.num)
        if (!Number.isInteger(num) || num < 1 || num > next.length) {
          errors.push(
            `num ${String(update.num)} out of range: the list has ${next.length} item(s), use a number between 1 and ${next.length}`,
          )
          continue
        }
        const item = next[num - 1]
        if (update.status !== undefined) {
          if (!STATUS_SET.has(update.status) || typeof update.status !== "string" || update.status.trim() === "") {
            errors.push(
              `status "${String(update.status)}" for item ${num} is invalid: use pending, in_progress or completed`,
            )
            continue
          }
          item.status = update.status
        }
        if (update.content !== undefined) {
          const content = String(update.content).trim()
          if (!content) {
            errors.push(`content for item ${num} is empty: use a concrete imperative description`)
            continue
          }
          item.content = content
        }
        if (update.priority !== undefined) {
          if (!PRIORITY_SET.has(update.priority) || typeof update.priority !== "string" || update.priority.trim() === "") {
            errors.push(`priority "${String(update.priority)}" for item ${num} is invalid: use high, medium or low`)
            continue
          }
          item.priority = update.priority
        }
        if (
          update.status === undefined &&
          update.content === undefined &&
          update.priority === undefined
        ) {
          errors.push(`update for item ${num} has no field to apply: pass status, content or priority`)
          continue
        }
      }
      return { todos: next, errors }
    }

    await ctx.tool.transform((editor) => {
      editor.add({
        name: "planwrite",
        description: PLANWRITE_DESCRIPTION,
        // codemode:false keeps this a direct tool rather than one hidden behind
        // the Code Mode `execute` tool. `permission` gives a stable action name
        // so it can be allowed/denied from configuration.
        options: { codemode: false, permission: "planwrite" },
        input: {
          type: "object",
          properties: {
            items: {
              type: "array",
              description: "The complete plan for this session.",
              items: {
                type: "object",
                properties: {
                  content: { type: "string", description: "Imperative description of the task." },
                  status: { type: "string", enum: STATUSES, description: "pending, in_progress, or completed." },
                  priority: { type: "string", enum: PRIORITIES, description: "high, medium, or low." },
                },
                required: ["content", "status", "priority"],
                additionalProperties: false,
              },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const todos = normalize(input && input.items)
          await write(context.sessionID, todos)
          // `metadata` travels with the tool result, so a client can render the
          // list structurally instead of parsing the text content.
          return { content: render(todos), metadata: { todos } }
        },
      })

      editor.add({
        name: "planupdate",
        description: PLANUPDATE_DESCRIPTION,
        options: { codemode: false, permission: "planupdate" },
        input: {
          type: "object",
          properties: {
            updates: {
              type: "array",
              description: "The updates to apply, each by number (num) in the current list. Pass several to avoid N calls.",
              items: PLAN_ITEM_SCHEMA,
            },
          },
          required: ["updates"],
          additionalProperties: false,
        },
        async execute(input, context) {
          const todos = await read(context.sessionID)
          if (todos.length === 0) {
            return {
              content: "no plan in this session: create it first with `planwrite`.",
              metadata: { todos, ok: false },
            }
          }
          const applied = applyUpdates(todos, input && input.updates)
          if (applied.errors.length > 0) {
            // nothing is written, the current list is shown next to the errors
            return {
              content: ["Nothing applied.", ...applied.errors, "Current list:", render(todos)].join("\n"),
              metadata: { todos, ok: false, errors: applied.errors },
            }
          }
          await write(context.sessionID, applied.todos)
          return { content: render(applied.todos), metadata: { todos: applied.todos } }
        },
      })

      editor.add({
        name: "planread",
        description: PLANREAD_DESCRIPTION,
        options: { codemode: false, permission: "planread" },
        input: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        async execute(_input, context) {
          const todos = await read(context.sessionID)
          return { content: render(todos), metadata: { todos } }
        },
      })
    })

    // Re-inject the list before every model request. This is what makes the list
    // survive compaction: the injected text is part of the outgoing request but
    // not of the persisted transcript, so it is re-added on every call.
    await ctx.session.hook("context", async (event) => {
      const todos = await read(event.sessionID)
      if (todos.length === 0) return

      const shown = todos.slice(0, MAX_INJECTED)
      const remaining = todos.length - shown.length
      const done = todos.filter((todo) => todo.status === "completed").length

      event.system.push({
        type: "text",
        text: [
          "<plan_list>",
          `${done}/${todos.length} done. Keep this plan current: plan with a sequential list of small steps via \`planwrite\`, ` +
            `mark items in_progress or completed by number via \`planupdate\` (no limit on the number of items).`,
          render(shown),
          remaining > 0 ? `... and ${remaining} more` : "",
          "</plan_list>",
        ]
          .filter(Boolean)
          .join("\n"),
      })
    })
  },
}
