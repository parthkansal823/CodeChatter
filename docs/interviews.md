# Interviews and assessments

Two ways to test someone, sharing a question bank, a timer the server keeps, a replay and a record of anything unusual.

| | **Interview** | **Assessment** |
|---|---|---|
| Who's there | An interviewer, on video with the candidate | Nobody: the candidate takes it alone |
| Who starts it | The interviewer | The candidate, between when it opens and closes |
| The questions | Asked as it goes: from the bank, at random, or written on the spot. Prepared ones stay hidden until asked | A fixed paper, drawn at random for each candidate |
| AI | Off, until the interviewer turns it on. They can change it as it runs | Off |
| Marking | There and then, in the room | Multiple choice and tests mark themselves. People mark the rest afterwards |
| Comparing people | A results table when several were scheduled together | A results table, CSV export, and comparing their code |

## The question bank

At `/interviews`, for the whole organisation. Each question has a difficulty, tags and marks, and is one of:

- **Coding:** starter files, and tests, some hidden. Scores for the best run of its tests, unless the interviewer gives a mark.
- **Multiple choice:** marked by the server. With more than one right answer the candidate is told to choose all that apply, and needs them all. They're shown in a different order for each person.
- **Short answer:** written, and marked by a person, with notes on what a good one says.
- **System design:** the candidate draws in the room's Diagrams or Board and explains it in writing. A person marks it.

**Import questions** fills it in one go, up to 200 at a time: paste from a spreadsheet with a first line naming the columns (`question`, `a`, `b`, `c`..., `answer` like `b` or `a;c`, and any of `kind`, `difficulty`, `marks`, `tags`, `model answer`), or a JSON list for any kind, coding included. It says which lines are wrong, and imports none until they're all right.

## An interview

1. **Schedule it** from **Schedule an interview** (or **Schedule many at once**, for a list of candidates). You can leave the questions until it's running. You get each candidate's link once, and can email it. Only its SHA-256 is stored; before anyone uses it, **New link** replaces it.
2. **The candidate opens the link.** No account is needed: **Join as ...** makes a guest account under their name, and **I have an account** signs in. The link now belongs to that person, and a second person is refused. They wait on a page that shows nothing of the questions, and they aren't in the room yet.
3. **You start it**, in the room's Interview panel or on its page, and join the video call from the panel. The timer starts on the server and the waiting page opens the room by itself. **+10 minutes** adds time.
4. **Ask questions** with **Ask a question**: from the bank, one at random (narrowed by kind, difficulty and tag), or one you write there and then. It appears for the candidate at once. A coding question's files arrive in the room with it, each in its own folder (`q2/main.py`). Your browser adds them, as the API doesn't touch live documents.
5. **Decide about the AI** with the switch in the panel. It goes on the record, and so does each time they use it. Allowed use doesn't count against them.
6. **Evaluate as you go:** their answers appear as they're given, and marks and the scorecard are in the panel.
7. **It ends** when you finish it, or when time runs out.

An interview scheduled from one coding question still has it from the start, as it always did.

## An assessment

1. **Make one** with **New assessment:** paste the candidates (one a line: `Ana Ruiz, ana@x.com`, `Ben <ben@x.com>`, or just an address), say what to draw from the bank (5 multiple choice tagged `sql`, 1 hard coding, and so on) and any questions for everyone, its length and when it opens and closes.
2. **Every paper is drawn before anything is made**, so a bank too small leaves nothing half-scheduled. Overlapping draws get a few tries before it says the bank can't do it.
3. **Save the links:** they're shown once. There's a CSV to download, and they can be emailed. Up to 200 people at a time.
4. **The candidate opens their link** and sees the rules, how many of each kind of question there are, and nothing else. They press **Start**, inside the window. Their time runs from then, whatever the window says after that.
5. **They answer**, saving as they go, and **hand in**, or the time runs out. Nobody starting before it closes is marked **Missed**.
6. **The results page** has a line for each candidate: status, score by kind, what's waiting to be marked, the record, and your verdict. **Compare their code** points at code that looks alike.

## What the candidate can't do or see

| Rule | How it's enforced |
|---|---|
| Right answers, model answers, marks and hidden tests never reach them | `apps/api/src/interviews/views.ts` builds what each role receives. Saving an answer doesn't say if it was right |
| Hidden inputs never touch their sandbox | Tests run in a throwaway container with no network and a copy of the files (`apps/runner/src/judge-box.ts`) |
| The rubric, scorecard, record and replay are interviewers' | Those routes need `interview.rubric`, which `candidate` doesn't have |
| No question before it starts | The candidate has no room membership until then, and the view is empty anyway |
| In an interview, no question before it's asked | Unasked questions are filtered out of their view, can't be answered or run, and their files aren't in the room |
| No guessing or choosing their paper | The server draws it, with a secure random source, when it's scheduled |
| No AI, unless an interviewer allows it | The API refuses `ai/chat` and `ai/complete`; the web hides the AI tab, suggestions and Explain/Fix |
| No internet from the sandbox | Rooms have no outbound network, and only the owner can open it for package installs |
| No copying the room out by forking | The API refuses to fork an interview room |
| One person per link | The first to use it owns it |

## The record: harder to cheat, honestly

**Nothing inside a browser can stop a determined person**: a phone next to the laptop beats all of it. So the aim is to make cheating harder, make it visible, and give people a fair view of what happened.

Candidates are told all of this before they start.

**What the candidate's page reports** (`integrity-guard.tsx`, every 15 seconds). Someone determined could switch this off:

- leaving the tab or the window;
- leaving full screen, if the sitting asks for it;
- pasting from outside, with how much (pasting their own code back isn't counted);
- trying to paste or copy a question, if the sitting blocks that;
- having a second screen, in Chromium browsers.

**What the server sees for itself** (`InterviewTestsService.heartbeat`), which the page can't hide:

- **A second tab or device:** two sessions taking turns reporting. A reload isn't mistaken for this.
- **A different network.** Only a hash of the address is kept, not the address.
- **The page going quiet** for over 90 seconds, which is what switching off the reporting looks like. So does a laptop going to sleep.
- **Big edits:** more text at once than a person types, from the room's edit log. Pasting, or a program writing a file.

**How it's read** (`integrityLevel`): *Nothing unusual*, *Worth a look* or *Concerning*. Leaving a tab now and then is normal; a second device isn't. It never fails anyone by itself.

**Comparing code** (`components/interviews/similarity.ts`) reduces code to its shape, so renaming things and changing spacing or comments doesn't hide a match, and compares fingerprints of it, the way MOSS does. Starter code doesn't count, nor what most of the group has. It runs in the interviewer's browser, from the edit logs, when asked. It's a pointer, not proof: short answers to the same small problem do look alike.

**Left out for now:** webcam or screen recording for assessments. It needs consent, storage and legal care for where people live, so it's a decision to make deliberately rather than a default.

## When it ends

The candidate's rights really go, whoever or whatever ended it:

1. `status` becomes `finished` through one conditional update, so with several API instances only one does the rest (`InterviewsService.closeSitting`). A timer in the API closes the ones whose `endsAt` has passed, every 10 seconds, and marks assessments nobody started as `missed`.
2. Their role becomes `viewer`, so they can read the room but not run anything or open a terminal.
3. The API publishes the room's code on Valkey (`ROOM_ACCESS_CHANNEL`). Every collab instance closes that room's sockets (`apps/collab/src/extensions/revocation.ts`), and clients reconnect and authenticate with their new rights. It has to close the socket: Hocuspocus's own `closeConnections` leaves it open, so the editor silently goes stale.
4. The sandbox restarts, which ends their terminals and programs.
5. Browsers hear `interview:changed`. The candidate's page reloads, showing the room read-only without any edit the server didn't take.

A write in the moment before this reaches nobody afterwards: read-only connections' updates are dropped.

## The replay

The replay reads the room's edit log (`doc_updates`), which is only deleted with the room. `GET /api/interviews/:id/replay/updates` sends every update with its time, and the browser rebuilds the files for any moment (`apps/web/components/interviews/replay.ts`). `GET /api/interviews/:id/replay` gives the slider's moments, thinned to 300, with runs and chat on the same line.

## Who sees what

An interview or a candidate's sitting: the people with the `interviewer` role in its room, and the organisation's owners and admins. An interviewer can bring a colleague in as a second interviewer. A batch's results: whoever made it, and the organisation's owners and admins. Deleting one (not while it's running) deletes its rooms, files, answers, runs, scorecards and replays.

## Limits

- **Kubernetes driver:** hidden tests need a throwaway container, so on that driver **Run tests** refuses with a clear message. Everything else works.
- **One scorecard per sitting:** two interviewers saving at once means the last save wins.
- **Two interviewers asking at once:** both questions get on the paper, but could share an id. Rare, and one person normally runs it.
- **Guests** are deleted a day after they're made, unless they're waiting for or in an interview. A deleted guest's runs stay, without their name. Guest sign-ins are limited to 20 an hour per network, so a whole class on one network should use accounts.
- **The replay shows files**, not Diagrams or Boards. Those stay in the room to look at.

## Tests

- `apps/api/src/interviews/paper.test.ts`: drawing papers, shuffling, marking, scoring, telling a reload from a second tab.
- `apps/api/src/interviews/views.test.ts`: a candidate's view has no hidden data, whichever mode.
- `packages/contracts/src/interviews.test.ts`: a question's and a batch's rules, reading pasted candidates and questions, reading the record.
- `apps/web/components/interviews/similarity.test.ts`: renaming doesn't hide a copy; starter code doesn't count.
- `apps/runner/test/judge-isolated.e2e.mjs`: a program trying to keep or send hidden inputs can't.
- `apps/collab/test/interviews.e2e.mjs`: the rules of one interview through the API, with real editor connections, including the timer taking rights from an open editor.
- `apps/collab/test/interview-papers.e2e.mjs`: papers, assessments, windows, questions asked live, the AI switch, marks, the record and the results.
- `apps/web/test/interviews.e2e.mjs`: one interview in a browser, with a guest candidate.
- `apps/web/test/interview-modes.e2e.mjs`: a live interview on video, and an assessment with its results and comparing code, in a browser.
