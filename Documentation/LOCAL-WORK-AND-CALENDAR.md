# Work of your own on the fly, one line per task, and a calendar

**Status:** decided 2026-11-24 (section 7), to build before 2.0.1 ships,
in three phases (section 6). **T1 built** (2026-11-24); migration 18 waits
for `pnpm db:check-migration` on the user's database. Comes from a user's feedback on 2.0.1-rc2; the mockups
were shown in the session that wrote this note.

## 1. What the user asked

- **A task on the fly, in a project.** Unplanned work -- "back up the
  dash's files" -- should start in one go as *Project : Task : (note)*.
  Today the picker's "A task of my own named …" always lands in *Your own
  work*, with no project and the one shared key (MISC-1), and a project of
  your own can only be made in Tasks.
- **The same task is one task** (as Solid Time does): the same name in the
  same project is the same task, and the day shows the sum of its entries.
  Today a second "A task of my own named X" makes a second X, and Today
  lists entries one by one.
- **A week view.** History has a timeline per day and a timesheet per week,
  but no calendar.

Kept as it is (the user's answer): interruptions. Stop on an interruption
takes the held task back up; they do not stack further.

## 2. A task on the fly (phase T1)

- **One line in the picker's search:** `Dash: Backup files: before v2`
  offers *Start Backup files in Dash*, with the note. One colon is
  *Project: Task*; none is a task in *Your own work*, as today. Enter starts
  the first row.
- **Or the form**, *Change project or note…*: Project (a combobox of the
  user's own projects, *Your own work*, and *New "…"*), Task, Note
  (optional). The one line prefills it.
- **A project named in it that does not exist is made**, as one made in
  Tasks: a project of your own (`OWN_PROJECT_PROVIDER_ID`), kept on this
  computer, its key from its name (DASH), its tasks DASH-1, DASH-2 -- not
  the shared MISC-1.
- **Main makes the project and the task, never the renderer**, inside the
  action that uses them, so Undo takes away what it made, as it does for
  work of your own today. The same choice reaches every picker that offers
  work of your own: Start, Switch, Add time, Split, Move.
- **The note is the running session's**, kept so a restart keeps it, and
  is the entry's comment at Stop, where it can still be changed. This needs
  a column on `active_sessions` (migration 18), so `pnpm
  db:check-migration` runs on the user's database before the build ships.

## 3. Local and online projects (the user's answer)

- **They stay apart.** A project of your own is never merged with a Jira,
  OpenProject or SprintTicker server project of the same name, and its time
  is never sent.
- **The picker offers both**, as it does now: typing `Dash:` finds the
  online project Dash's tasks too, under their own heading. Only *Start …
  in Dash* makes work of your own.
- **Two projects with the same name are told apart by a mark** beside the
  name, shown only where names collide: a computer for *this computer*, and
  the provider's name for the other (only one provider is active at a time).
  The user suggested emoji; the window's own icons are drawn in its colour
  tokens, so the mark is a `lucide` icon with the provider's name, never
  colour alone.

## 4. One line per task (phase T2)

- **The same name in the same project is the same task**, case and spaces
  aside: *Start Backup files in Dash* when it exists starts that one, and
  the picker says *already yours · 2 entries today, 48m*. No second task is
  made. *Your own work* follows the same rule.
- **Today groups by task:** one line per project and task, with the day's
  sum and the number of entries, unfolding into the entries. Each entry
  keeps its own note, ⋯ and send. **Today opens on *Entries*, the list as
  it is now, with a toggle at its top right** for *By task* (the user's
  choice, 2026-11-24).

## 5. The calendar (phase T3)

The week in History as columns, the entries as blocks over the hours, as in
the mockup: the running entry green, an entry held by an overlap amber, a
gap dashed, an interruption with its ⚡. Overlaps of the week are listed
under it, each with its fixes (end the first where the second starts, start
the second where the first ends, Correct).

Like Google Calendar, every change an entry may need is made on it:

- **A click on an empty slot adds an entry there**, through Add time:
  dragging over the slot sets its length.
- **A click on a block selects it**: handles at its top and bottom change
  its start and its end.
- **Dragging a block moves it**, to another hour or another day.
- **A click on a selected block opens its actions**: Correct, Split in two,
  Move, Delete. **Delete** on the keyboard deletes it.

Each gesture goes through the commands the rows already use -- Add time,
Correct, Move, Delete, with the ten-second Undo -- so the closed-week
warning, the overlap rule and the provider's corrections apply as they do
everywhere, never copied into the calendar.

## 6. Phases

| Phase | What | Done when |
| :--- | :--- | :--- |
| **T1** | A task on the fly: the one line, the form, projects of your own made there, the note on the session (migration 18) | Each picker path tested; migration checked on the user's database |
| **T2** | One task per name and project; Today by task | The dedupe and the grouping tested |
| **T3** | History's calendar with the Google Calendar gestures, and the overlaps listed | Each gesture tested through the shared commands |

## 7. The user's answers (2026-11-24)

1. **Today opens on the entries**, as now, with a toggle at its top right
   for the view by task.
2. **The note is kept on the session**, with migration 18.
3. **Projects of the same name get a mark**: an icon for this computer, the
   provider's name for the other.
