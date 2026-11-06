# Interview mode

Coding interviews in a real room: a shared editor and terminal for the candidate, tests with hidden cases, a timer the server keeps, a private scorecard, a replay and a report.

## How it goes

1. **Write a question** at `/interviews` (Question bank): the text, starter files, tests (some hidden), scoring criteria and the length. The bank belongs to the organisation.
2. **Schedule an interview.** This copies the question, so later edits to the bank don't change it, and makes a private room. You get the candidate's link once, and can email it. Only its SHA-256 is stored; before anyone uses it, **New link** replaces it.
3. **The candidate opens the link.** No account is needed: **Join as ...** makes a guest account under their name, and **I have an account** signs in. The link now belongs to that person, and a second person is refused. They wait on a page that shows nothing of the question, and they aren't in the room yet.
4. **You start it**, in the room's Interview panel or on the interview's page. The timer starts on the server and the waiting page opens the room by itself. **+10 minutes** adds time.
5. **It ends** when you finish it, or when time runs out.
6. **Afterwards**, the interview's page has the scorecard, every run with its hidden cases, the replay, and a report to copy or download as Markdown.

## What the candidate can't do or see

| Rule | How it's enforced |
|---|---|
| Hidden inputs, expected outputs and output never reach them | `apps/api/src/interviews/views.ts` builds what each role receives; hidden cases come back as counts |
| Hidden inputs never touch their sandbox | Tests run in a throwaway container with no network and a copy of the files (`apps/runner/src/judge-box.ts`) |
| The rubric, scorecard and replay are interviewers' | Those routes need `interview.rubric`, which `candidate` doesn't have |
| No question before it starts | The candidate has no room membership until then, and the view is empty anyway |
| No AI while it runs | The API refuses `ai/chat` and `ai/complete` for the `candidate` role; the web hides the AI tab, suggestions and Explain/Fix |
| No copying the room out by forking | The API refuses to fork an interview room |

## When it ends

The candidate's rights really go, whoever or whatever ended it:

1. `status` becomes `finished` through one conditional update, so with several API instances only one does the rest (`InterviewsService.close`). A timer in the API closes interviews whose `endsAt` has passed, every 10 seconds.
2. Their role becomes `viewer`, so they can read the room but not run anything or open a terminal.
3. The API publishes the room's code on Valkey (`ROOM_ACCESS_CHANNEL`). Every collab instance closes that room's sockets (`apps/collab/src/extensions/revocation.ts`), and clients reconnect and authenticate with their new rights. It has to close the socket: Hocuspocus's own `closeConnections` leaves it open, so the editor silently goes stale.
4. The sandbox restarts, which ends their terminals and programs.
5. Browsers hear `interview:changed`. The candidate's page reloads, showing the room read-only without any edit the server didn't take.

A write in the moment before this reaches nobody afterwards: read-only connections' updates are dropped.

## The replay

The replay reads the room's edit log (`doc_updates`), which is only deleted with the room. `GET /api/interviews/:id/replay/updates` sends every update with its time, and the browser rebuilds the files for any moment (`apps/web/components/interviews/replay.ts`). `GET /api/interviews/:id/replay` gives the slider's moments, thinned to 300, with runs and chat on the same line.

## Who sees an interview

The people with the `interviewer` role in its room, and the organisation's owners and admins. An interviewer can bring a colleague in as a second interviewer from the room's Share dialog. Deleting an interview (from its page, not while it's running) deletes its room, files, runs, scorecard and replay.

## Limits

- **Kubernetes driver:** hidden tests need a throwaway container, so on that driver **Run tests** refuses with a clear message. Everything else works.
- **One scorecard per interview:** two interviewers saving at once means the last save wins.
- **Guests** are deleted a day after they're made, unless they're waiting for or in an interview. A deleted guest's runs stay, without their name.

## Tests

- `apps/api/src/interviews/views.test.ts`: a candidate's view has no hidden data.
- `apps/runner/test/judge-isolated.e2e.mjs`: a program trying to keep or send hidden inputs can't.
- `apps/collab/test/interviews.e2e.mjs`: every rule through the API, with real editor connections, including the timer taking rights from an open editor.
- `apps/web/test/interviews.e2e.mjs`: the whole flow in a browser, with a guest candidate.
