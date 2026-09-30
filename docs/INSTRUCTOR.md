# OrgoCraft — Instructor guide (D2L Brightspace)

OrgoCraft is a browser game for Organic Chemistry I (McMurry chapters 1–11). It runs entirely in the student's browser: there is no server, no account and no data leaves your Brightspace course. You can deliver it in two ways.

| | Path A — course file (no grade) | Path B — SCORM package (grade item) |
|---|---|---|
| File | `orgocraft-v<version>-d2l.zip` | `orgocraft-v<version>-scorm12.zip` |
| Where it goes | Manage Files, then a Content topic | Content → New SCORM/xAPI Object |
| Score | Saved on the student's device only | Reported to a grade item (0–100) |
| Progress across devices | No | Yes (through the SCORM attempt) |
| Badge shown in the game | "Progress saved on this device - not connected to the gradebook" | "Connected to course gradebook" |

Use Path B when the game counts toward a grade. Use Path A for practice or if SCORM is not enabled at your institution. The two packages contain the same game.

## 1. Path A — upload as a course file

1. Course Admin → **Manage Files**.
2. **Upload** → choose `orgocraft-v<version>-d2l.zip` (it is under 1 MB; the limit is 2 GB).
3. Open the zip's action menu (the ▾ next to its name) → **Unzip**. Wait for the notification that the background job finished.
4. Tick `orgocraft-v<version>/index.html` → **Add Content Topics** → choose the module and give the topic a title (for example "OrgoCraft — build molecules").
5. Open the topic once to confirm the game loads and the badge says "Progress saved on this device".

Do **not** click **Edit HTML** on the topic: the Brightspace editor removes the game's script tag and the page goes blank. To update the game later, upload the new zip (it unzips into a new `orgocraft-v<newversion>/` folder), then on the topic choose **Change File** and pick the new `index.html`. Never overwrite files inside the old folder — students' browsers may keep the old `index.html` and show a blank page.

## 2. Path B — upload as a SCORM package with a grade item

Use the **new SCORM player** (Content Service). Do not import the zip through Course Admin → Import/Export/Copy Components: that is the legacy player, which only records the latest attempt, marks the topic complete as soon as it is opened, and is not reported in Data Hub.

1. Content → open the module → **Upload/Create** → **New SCORM/xAPI Object**.
2. In the "Add Course Package" dialog click **Upload** and choose `orgocraft-v<version>-scorm12.zip`. Wait for the upload to finish.
3. Title: "OrgoCraft" (or your own).
4. **Create a grade item?** → **Yes**.
5. **Grade Calculation Method** → **Highest Attempt**. (Students can replay; the game never lowers a score within an attempt, but a fresh attempt starts at 0 and Highest Attempt keeps their best.)
6. **Course Package Player Options** → **Open player in new window** (recommended, see section 4).
7. **Save**.
8. Grades → **Manage Grades** → open the new item → set **Maximum Points** to **100**, put it in the category you want, and set its weight. The game reports a 0–100 score, so 100 points makes the gradebook value equal to the game's percentage.

If you answered No in step 4, you can still attach a grade item later: open the topic's action menu → **Edit** → grade item settings. Menu labels may differ slightly between Brightspace versions; look for the equivalent wording.

## 3. How the score works

- Every challenge is worth 2 (easy), 4 (medium) or 8 (hard) points. The score is the percentage of points earned over all enabled challenges, rounded to a whole number. The total is shown in the game's challenge panel.
- Build challenges can be retried without penalty. Quizzes, "select the atom" and "choose the reagent" challenges earn full points on the first try, half on the second, nothing after that.
- The score is sent to the gradebook every time a challenge is solved, and again when the student clicks **Save & Exit**. It never goes down within an attempt.
- The pass mark is **70 %** (the package's `masteryscore`). The game sets the SCORM status to *passed* at 70 % and *incomplete* below; *failed* is written only when the student clicks Save & Exit after attempting every challenge (every build challenge submitted at least once, every quiz and selection answered or out of attempts) without reaching 70 %. Brightspace's completion indicator for the topic follows this status.
- Students can leave and come back: the game asks Brightspace to *suspend* the attempt, and progress resumes from where they were. When every challenge is solved the attempt ends normally.
- Progress is also kept in the student's browser, keyed to their Brightspace user id, as a safety copy. Another student on the same computer never sees it. A restored safety copy is never sent to the gradebook by itself — not on Save & Exit, not when the window is closed — it is reported the next time that student solves a challenge.
- Resetting a student's attempt in Brightspace also discards the safety copy on their next launch (a launch with no saved progress, no status and no score is treated as a genuinely new attempt), so a reset really starts them over. If Brightspace keeps the status or score but loses the progress string, the safety copy is used instead.

### Changing the pass mark or hiding challenges

The pass mark, the list of disabled challenge ids and the enabled reagent cards live in `orgocraft.config.json` in the source repository and are built into the package. To change them, ask whoever builds the package to edit that file and run `npm run release`; then re-upload the package (Path B: upload the new zip as a new SCORM object, or use the topic's replace option if your Brightspace version offers it; grade calculation stays Highest Attempt). Editing `imsmanifest.xml` by hand changes only the number Brightspace stores, not the pass mark the game uses.

## 4. Embedded player or new window?

- **Open player in new window** (recommended): the game gets the whole window, the mouse can be captured for looking around, and Fullscreen works. Students must allow pop-ups for your Brightspace site; the game shows an "Open in new tab" link only when it is not connected to the gradebook, so tell students to use the player's own **Exit** button when done (the game shows "Progress saved — use the player's Exit button" after Save & Exit).
- **Embedded player**: the game runs in a fixed-height frame inside the Content page. It still works (the panels shrink and can be collapsed to their title bars below 640 px of height, and a **Fullscreen** button appears when the player allows fullscreen), but it is cramped on laptops.

In both modes, when a student simply closes the window the game saves first (Brightspace is told to suspend the attempt), but closing the pop-up without Save & Exit has been reported to start a new attempt in some Brightspace versions. Highest Attempt grading protects the score either way.

## 5. Testing before release (do this once on your course)

Log in as a **test student** with the Learner role. "View as Learner" does not exercise SCORM resume or grading.

1. Path A only: open the topic; in the browser's developer tools (F12 → Console) there are no red errors and no 404 for `assets/index-….js`.
2. The game fills the frame or window; the toolbar, hotbar (bottom), challenge panel (left) and molecule panel (right) are all visible and nothing covers the hotbar; the page behind does not scroll when pressing Space or the arrow keys while playing.
3. Click the world: the mouse is captured; Esc releases it and opens the pause menu. If capture is refused, dragging turns the view and a "Drag to look" hint appears.
4. Path B: the badge reads "Connected to course gradebook".
5. Solve the first challenge (place one carbon block on the lab pad for "Build methane", press Enter). The panel shows "Solved" and the score line updates.
6. Click **Save & Exit** → confirm → the overlay says "Progress saved". Close the window with the player's Exit button.
7. Grades → the test student's grade for the item shows the percentage the game displayed.
8. Open the activity again as the same test student: the solved challenge is still marked solved and the score is unchanged.
9. Shared-computer check: on the same browser, log out and log in as a second test student, open the activity: no progress is shown and no grade appears for the second student until they solve something.
10. Try once in Chrome with third-party cookies blocked and once in Safari; note any pop-up blocking in new-window mode.
11. Optional: the free SCORM Cloud sandbox (scorm.com) shows every API call the package makes; upload the same zip there if Brightspace shows no score.

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Blank page, console shows 404 for `assets/…` | The topic points at an `index.html` from an old folder, or files were edited in place | Upload a new versioned folder; on the topic use Change File |
| Blank page after clicking "Edit HTML" | The Brightspace editor removed the script tag | Delete the topic and add it again from Manage Files (do not edit) |
| Badge says "Progress saved on this device" in Path B | The SCORM API was not found within 2 s | Make sure the topic was added as a SCORM/xAPI Object (new player), not through Import Components; try "Open player in new window"; check that pop-ups are allowed |
| Badge says "Review mode" | The topic was opened in review/browse mode (for example after the due date, or as an instructor) | Scores are not recorded in review mode; open it as a Learner during the availability window |
| Badge says "last save failed, retrying" | Brightspace rejected a call (session expired, network) | The game keeps a local copy; the next solved challenge retries. If it persists, Save & Exit, reopen the activity |
| Grade never appears | The student never solved a challenge (the game does not write a score of 0), or the grade item is not associated | Solve one challenge and Save & Exit; check the topic's grade item association |
| Score in Grades is lower than the game shows | Grade calculation method is First/Last/Lowest Attempt and a later attempt scored less | Set the method to Highest Attempt |
| Progress lost after closing the pop-up window | The Brightspace player started a new attempt | Ask students to use Save & Exit. A genuinely new attempt (no status, no score) starts the game from zero on purpose (it is indistinguishable from an instructor reset); the previous attempt's score is kept by Highest Attempt grading. If Brightspace kept the status or score, the game restores its local safety copy on the same device and re-reports at the next solved challenge |
| Game is tiny / hotbar cut off in the embedded player | Fixed-height frame | Collapse the panels (button in each panel header), use the Fullscreen button if the player shows one, or switch the topic to "Open player in new window" |
| Mouse look does not work | Pointer capture refused by the browser or a sandboxed frame | Drag to look, or use the arrow keys; Fullscreen usually allows capture |
| "OrgoCraft needs WebGL" message | Browser has WebGL disabled or no GPU driver | Try another browser or enable hardware acceleration |
| Space or arrows scroll the Brightspace page | The game canvas is not focused | Click the game once; Tab leaves the game area on purpose |

## 7. Accessibility and privacy

- Every action has a keyboard equivalent (press H in the game for the list); screen readers receive status announcements; there are no time limits. A 3D game cannot be fully WCAG-conformant; if a student needs an accommodation, contact the developer for the text-mode alternative planned for a later version.
- Nothing is transmitted except the SCORM score, status, bookmark and a short progress string to Brightspace. The local safety copy in the browser contains the same progress string and the Brightspace user id. Clearing site data removes it.
