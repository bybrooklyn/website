# mdQuire UX and UI audit

Audited on 13 November 2026 against the build in `dist/`, driven in headless Chromium through `scripts/browser.ts`. Main pass at 1300 by 800 in the dark look. Spot checks in light paper, page view and at 390 wide.

Severity words: **blocks work**, **wrong**, **confusing**, **rough**, **taste**.

"Decided" marks a finding that the planned menu work should resolve (Docs' order and names, an icon on every line, folded groups, one place per thing, alignment and lists as one button each). Docs behaviour is from memory throughout. Where I am less sure it says so.

---

## 1. Menus

### 1.1 Typing with a menu open goes into the document
- Where: any menu word pressed with the mouse. `src/quire/menu-row.ts`, `createMenuRow` (`open(index, document.activeElement === word)`), and `flowMenu` in `src/quire/ui.ts`.
- What happens: a menu opened by a click does not take the keyboard. Arrow keys do nothing in the menu. A letter is typed into the text behind it. I pressed File, then `f`, and "two" became "twof".
- Expected: as in Docs, arrows move through the open menu, a letter jumps to a line, Enter runs it, and nothing reaches the document.
- How bad: **wrong**. It changes the document without the writer seeing it.
- Smallest fix: always give the menu the focus when it opens (`menu.open(..., true)`), or swallow keydown on the document while any `flowMenu` is open.

### 1.2 A line with an arrow is not a submenu. It replaces the menu
- Where: every line ending in `›`. `src/quire/editor.ts` `actions` (lines 630 to 739), `src/quire/more-commands.ts`.
- File: Download as, Page setup.
- View: Notes, Zoom.
- Insert: Special characters; Header, footer and page numbers.
- Format: Capitalisation, Text color, Text size, Typeface, Highlight, Line spacing, Bullets and numbering.
- Tools: Checking.
- What happens: the parent closes and a second small menu opens from the menu word. Escape closes everything and puts the caret in the text. There is no way back to the parent.
- Expected: Docs opens a flyout beside the line, keeps the parent open, and Left or Escape steps back one level.
- How bad: **confusing**.
- Smallest fix: on Escape or Left in a child, reopen the parent with the line that opened it focused. Later, a real flyout that grows from the line.

### 1.3 The child menus open in three different places
- What happens:
- Download as, Capitalisation, Text color and the other Format pickers open with their left edge under the word (File at x 469, Format at x 667).
- Page setup opens to the left of File and hangs over the Paragraph and typeface controls (x 330 to 510).
- Zoom opens to the left of View (x 396). Notes opens further left (x 235).
- Search the menus, run from Tools, opens under the three dots at the far right (x 905).
- Zoom chosen from the palette at the bottom left opens under View at the top.
- Cause: `flowMenu("Zoom", { align: "right" })` and `flowMenu("Page setup", { align: "right" })` in `src/quire/editor.ts` lines 449 and 450; `notes.list`; `bar.search()` always uses the bar's own button.
- How bad: **rough**. It breaks the rule that things flow from where they were pressed.
- Smallest fix: drop `align: "right"` for menus opened from a menu word. Pass the pressed element to `bar.search` and to palette commands that open a menu.
- Pictures: `sub-file-page.png`, `sub-view-zoom.png`.

### 1.4 The View menu
- Where: `src/quire/menu-row.ts`, `headings`, the View block. Picture: `menu-view.png`.
- What a writer sees, top to bottom: Outline, The Markdown beside the page, Notes ›, Next note, Previous note, No page, Light paper, Page view, Zoom ›, Zoom in, Zoom out, Zoom back to the usual. No rules between groups. No ticks. A line that is on is only drawn in violet.
- Problems:
1. **No page, Light paper and Page view read as one choice of three. They are not.** No page and Light paper are a choice of two, and the menu stays open when one is pressed. Page view is a separate switch, and the menu closes. In page view two of the three are violet at once. **confusing**.
2. **The names do not say what they do.** "No page" sounds as if the document goes away. "Light paper" already shows a white sheet that looks like a page. "Page view" shows much the same sheet cut into pages. A Docs writer knows "Print layout" (a tick) and may know "Pageless" (from memory, in Page setup). **confusing**.
3. **Zoom is there four times, with two names for one thing.** Zoom ›, Zoom in, Zoom out, Zoom back to the usual. Inside Zoom › are Zoom in, Zoom out and "Usual size (100%)" again, then a "100%" line, so 100% is offered twice. **confusing**.
4. **The Zoom child holds things that belong elsewhere.** Its first line is Page view and its last is Page setup ›. Page view is also in View. Page setup is also in File. (`zoomLines`, `src/quire/editor.ts` line 512.) **confusing**.
5. **Next note and Previous note sit loose** between Notes › and the looks. The Notes child already has them as its first two lines, in the other order. **rough**.
6. **"The Markdown beside the page" is a sentence.** The three dots call the same switch "Show the Markdown" and "Hide the Markdown". **confusing**.
7. **State is not drawn consistently.** Outline is violet with an icon. No page is violet with none. A switch and a choice look the same.
- Expected (Docs, from memory): Mode, then Print layout, Ruler, Show outline, Show equation toolbar, Show non-printing characters, each a tick line, then Full screen. Zoom is a control in the bar.
- Smallest fix: three groups with rules, and a tick for what is on.
- Group one, ticks: "Show outline", "Show Markdown", "Show comments".
- Group two: "Print layout" as a tick (today's Page view), and "Paper" as a tick or a labelled choice of two.
- Group three: one "Zoom ›" line holding Zoom in, Zoom out, Fit and the percentages, with 100% once.
- Take Page view and Page setup out of the Zoom child. Take Next and Previous note out of the top level.
- "Decided" covers order, names, icons and one place per thing. It does not yet cover the two-plus-one choice or the tick.

### 1.5 Format and Insert do not fit the window and do not show that they scroll
- Where: Format has 37 lines, Insert 21. `quire-menu-items` scrolls with no fade at the cut edge.
- What happens at 800 high: Format ends on a half-cut "Quote". Everything from Text color down is out of sight (colour, size, typeface, highlight, line spacing, alignment, indent, lists, clear formatting). Insert cuts "Bookmark" in half.
- How bad: **wrong** on a laptop screen.
- Smallest fix: **Decided** (folded groups). Until then, a fade at the cut edge.
- Picture: `menu-format.png`.

### 1.6 Shortcuts are shown as Mac symbols on Linux and Windows
- Where: `keySymbols` in `src/quire/ui.ts` line 359. Menus, the palette, the shortcuts dialog.
- What happens: Ctrl is drawn `⌃` and Alt `⌥`, so Footnote shows `⌃⌥F`. The bar's tooltips say "Ctrl+B". The status line says "Press Ctrl+Shift+V". One Download as line says "Ctrl+P" in words.
- Expected: Docs on Linux and Windows writes "Ctrl+Alt+F".
- How bad: **confusing**.
- Smallest fix: when `onMac` is false, show the words.

### 1.7 Strikethrough shows a different shortcut in each place
- The Format menu and palette show Alt+Shift+5. The bar's tooltip shows Ctrl+Shift+X (`src/quire/bar.ts` line 841, `src/quire/shortcuts.ts` lines 43 and 44). Docs uses Alt+Shift+5.
- How bad: **rough**. Fix: the tooltip takes its keys from `keysFor("strike")`.

### 1.8 The same thing in several menus under different names (Decided; listed so none is missed)
- Version history: File, Tools and the three dots.
- Link: Edit and Insert.
- Lists: Bulleted, Numbered and Checklist in Insert; Bullets and numbering in Format.
- Download: File has "Download" (.quire), "Download as Markdown" and "Download as ›". Download as holds the same two again as "mdQuire" and "Markdown". The three dots have the first two once more.
- Documents: File has "All documents" (the home list) and "Documents" (the small list under the name). The name in the top bar and the "mdQuire" word in the trail are a third and fourth way.
- About mdQuire: Tools and the three dots.
- Print: File, the bar, the three dots, and "PDF, through the print dialog" in Download as.
- Checking: "Checking ›" in Tools; "Spelling and checking" in the bar and the three dots.
- Find: "Find" and "Find and replace" open the same bar. Once the replace row has been opened, "Find" opens with it still open.

### 1.9 No rules between groups, and icons on about a third of the lines
- No menu has a separator.
- Icons: File 2 of 13, Edit 4 of 8, View 1 of 12, Insert 12 of 21, Format 12 of 37, Tools 2 of 10.
- Shared or borrowed icons: Callout and Quote share one. Folding section uses the chevron that means "this opens" elsewhere. Definition list uses the indent icon. In the picture's menu, Caption uses the footnote icon, Description the quote icon, Size the picture icon, Replace the redo icon.
- **Decided** (an icon on every line). Add rules in the same pass, and give each thing its own icon.

### 1.10 No key opens a menu
- Alt+F, Alt+E and so on do nothing. Docs opens File with Alt+F in Chrome (from memory).
- How bad: **rough**. Fix: Alt plus the first letter opens that menu.

### 1.11 Lines that do nothing or only say something
- Format, Bullets and numbering, outside a list: the child holds one sentence, "Put the cursor in a list to choose its bullet or its numbers". Dead end. Fix: grey the line out.
- Insert, Bookmark, in a heading: the child holds "A heading is a place to link to already". Dead end. Fix: grey it out, or copy the heading's link.
- Insert, Header, footer and page numbers, outside page view: the fields take the words and nothing shows. No message, no switch to page view. **wrong**. Fix: turn page view on when one is set.
- Tools, Typed signs: the menu closes and nothing confirms the change. No page and Light paper keep the menu open. **rough**.

---

## 2. Insert and what it makes

### 2.1 Table
- **Size.** Insert, Table drops a 3 by 3 table at once. Docs shows a grid to drag out the size. **taste**.
- **The strip covers what is above the table.** It floats over the table's top right corner, 38 px high, on the line before the table. `createTableTools`, `src/quire/tables.ts`. **rough**. Fix: use a real gap above, else go below, else into the bar. Picture: `table-strip2.png`.
- **No row above, no column to the left, no delete table.** The strip has only "Add a row below", "Remove this row", "Add a column to the right", "Remove this column", three alignments and two sorts. **wrong**. Fix: add the three, or put all of them in a right-click menu.
- **Right-click in a table opens nothing of mdQuire's.** Docs' right-click has insert row and column, delete row, column and table. **confusing**. Fix: reuse `tableTools.lines`, already built for the palette.
- **Live buttons that do nothing.** "Remove this row" in the heading row (`removeRowHere` returns the state unchanged), and "Remove this column" on the last column. **rough**. Fix: disable and dim them.
- **The four add and remove icons are hard to tell apart** at 15 px. The sort buttons are text ("A→Z"). **rough**.
- **Enter moves to the cell below**, as a spreadsheet does. Docs starts a new line in the cell. Markdown cells cannot hold a line break, so that is defensible.
- **Enter in an empty last row deletes that row and leaves the table.** A writer who tabbed into a new row and pressed Enter loses the row. `src/quire/keys.ts`. **confusing**. Fix: never delete, or only a row Tab just made.
- Shift+Enter does nothing.
- These work: Tab past the last cell adds a row. Sort orders numbers by value and keeps empty rows last. Centre shows as pressed.
- Sort buttons do not show which way the column is sorted now. **taste**.

### 2.2 Picture
- **The strip covers the last line of the paragraph above.** Picture: `pic-2.png`.
- **A blank slot sits in the strip** when the picture is at its own size. The "Its own size" button is hidden but keeps its room (`own.classList.toggle("absent")`, `src/quire/picture-tools.ts`). When shown it is the words "Own size" among icons. **rough**. Fix: collapse the slot and use an icon.
- **Four menu lines open one panel.** Caption, Description, Alignment and Size differ only in which field gets the focus. Alignment is already in the strip. **confusing**. Fix: one line, "Picture options", then Wrap text, Replace, Remove. Docs has one "Image options" line.
- **Enter in Caption or Description throws the keyboard away.** Focus lands on the page body (`input.blur()` on Enter). **wrong**. Fix: focus the picture or the next field.
- **Wrap text is three different controls.**
- In the menu it is a line that toggles.
- In the panel it is a button whose label is its state ("Off").
- With the picture centred, the panel's button is greyed with no reason given. The menu line still works and silently moves the picture to the left.
- **confusing**. Fix: one switch, the same in both. When centred, say "Left or right only".
- **The panel is set differently from everything else.** Its labels and controls are right-aligned, and its corner radius is about 20 px where menus are about 12 px. **taste**. Picture: `pic-wrap.png`.
- **A picked picture and a blinking caret show together.** **rough**. Fix: hide the caret while a picture is picked.
- These work: right-click, the three dots, Escape (panel first, then the picture), Backspace to remove, undo, corner resize, drag.
- Dragging a picture below the last paragraph landed it one block short in one try. Not repeated.

### 2.3 Code block
- **A blank line cannot be typed.** Enter on an empty last line leaves the block. Typing `a`, Enter, `b`, Enter, Enter, `c` gives a block holding "a, b" and a paragraph "c". **wrong**. Fix: leave only on a third Enter, on Ctrl+Enter, or with Down from the last line.
- **The language field is invisible until the pointer is over the block** (`src/styles/quire-markdown.css` line 99). **confusing**. Fix: always show a quiet "Plain text ▾" in the corner.
- **The language field is a native input with a browser datalist.** Every other choice is a menu of mdQuire's own. **rough**. Fix: a `flowMenu` of the 16 languages.
- **Enter in the language field throws the keyboard away.** **wrong**. Fix: put the caret back in the code.

### 2.4 Callout
- **Pressing the label steps round five kinds** (Note, Tip, Important, Warning, Caution). The choices cannot be seen, and going back one takes four presses. `src/quire/surface.ts` line 513. **confusing**. Fix: the label opens a menu of the five.
- The bar's style box says "Quote" in a callout. **rough**.

### 2.5 Folding section
- **The arrow does not fold the section.** It sets whether readers first see it open ("Starts closed; press to start it open"). The body always shows in the editor. `src/quire/surface.ts` line 487. **confusing**. Fix: let the arrow fold it in the editor too, or label the control in words.
- **The placeholder "What is folded away" is bold at heading size** and reads as real text. The caret starts in the body, so the summary is easy to miss. **rough**. Fix: caret in the summary first, a quiet "Summary" placeholder.
- **Enter in the summary throws the keyboard away.** **wrong**. Fix: Enter moves the caret into the body.

### 2.6 Definition list
- Nothing says which line is the term and which the meaning. An empty one is a bold blank line and a thin rule. **confusing**. Fix: placeholders "Term" and "Definition".
- Keys inside it were not checked (section 11).

### 2.7 Maths and Diagram
- **Both show a "language" field**, labelled `math` or `mermaid`. Changing it would turn the block into plain code. **confusing**. Fix: no language field on these two; label them "Maths" and "Diagram".
- **In the maths block the small label crowds the first line of code.** **rough**.
- **"Maths, written below in TeX"** on an empty maths block. "TeX" is jargon. **taste**.
- **A diagram that stops parsing says "Shown as code: mdQuire draws flowcharts only"**, even when it is a flowchart with a slip in it. **confusing**. Fix: "Could not draw this" when the first word is `flowchart`.
- A new diagram arrives filled with a sample flowchart.
- Picture: `ins-diagram.png`.

### 2.8 Footnote
- The caret jumps into the note under the paragraph. There is no visible way back. **rough**. Fix: Escape returns to just after the mark.

### 2.9 Page break
- Works. It draws a dashed rule with "Page break".

### 2.10 Date
- Inserts "November 13, 2026" as plain text. Docs opens a date chip. **taste**. The order is American while "Centre" and "Capitalisation" are British.

### 2.11 Special characters
- Works: a grid with a search, stays open, Escape gives the text back.
- It is a menu, so it sits over the bar. **taste**.

### 2.12 Table of contents
- After one is inserted, the Insert line becomes "Update the table of contents". The table does not update by itself and has no control of its own. Docs puts a refresh button on the table. **confusing**. Fix: an "Update" control on the table when the cursor is in it.

### 2.13 Comment
- **Two words for one thing.** Insert says "Comment". The panel, the field and View say "Notes", "Note", "Next note". The empty list says "Select some words and choose Insert, Comment". **confusing**. Keep Comment.
- The buttons are "Keep" and "Cancel". Docs says "Comment" and "Cancel". Enter makes a new line and Ctrl+Enter keeps, as in Docs.
- The card's actions are the words "Resolve" and "Edit" and a bin icon. **rough**.

### 2.14 Header, footer and page numbers
- A box with two fields and a "Page numbers" line. Placeholders are the only labels. No Done button. No tick on Page numbers. Enter does not close it. Picture: `sub-insert-header.png`.
- Outside page view it has no visible effect (1.11).
- Docs lets you click into the header on the page. **confusing** here, because the result appears somewhere else. Fix: in page view, pressing the header area opens the box from that spot; add a tick and Done.

### 2.15 Bookmark
- A field prefilled "bookmark" and an "Add" button, opening over the bar. Works. The suggested name is always "bookmark". **taste**.

### 2.16 Link
- **An address typed without a scheme is kept as typed.** "example.com" becomes `href="example.com"`, a link to a page on the writer's own site that does not exist. Docs adds the scheme. `linkForm`, `src/quire/ui.ts` line 246. **wrong**. Fix: add `https://` when there is a dot and no scheme, no leading `/` or `#`.
- **The link box opens in two places.** From the selection bar it replaces that bar, by the words. From Ctrl+K or the menus it drops from the three dots at the top right, because the Link button has folded into the dots at 1300 wide. **confusing**. Fix: Ctrl+K always opens at the selection. Pictures: `sel-link.png`, `sel-link2.png`.
- **At the selection, the box covers the next line**, and the selected words lose their highlight while the field has the focus. **rough**. Fix: keep the selection drawn, as find does.
- **Clicking a link shows nothing.** Docs shows a card with the address, copy, edit and remove. Here Ctrl+K is the only way. **confusing**.
- Ctrl+K with nothing selected offers only an address field. Docs asks for the words too.
- The button says "Set"; Docs says "Apply". Remove is a bin icon. **taste**.

### 2.17 Horizontal line
- Works. Insert calls it "Horizontal line"; the slash list calls it "Divider". **rough**.

### 2.18 Emoji
- A colon and letters opens a list above the caret; Enter takes the first. Works. There is no emoji line in Insert. **taste**.

---

## 3. Dialogs and panels

### 3.1 Five kinds of surface for the same kind of job
- A **dialog** (dimmed page, filled button bottom right): Word count, Keyboard shortcuts, dictation's first launch, Not saved.
- A **menu holding a form or text**: About, Page setup, Header and footer, Bookmark, Link, Restart numbering, Checking settings, the checking list, the GitHub form, the documents list, Dictation settings, Special characters.
- A **side panel**: Version history, Picture, the conflict panel.
- A **bar floating over the text**: Find and replace, the selection bar, the table strip, the picture strip.
- A **status word** at the top right: "Forgotten", "Press Ctrl+Shift+V", "1 selected".
- A writer cannot guess which a command will give. About is a menu; Word count, with as much in it, is a dialog. Page setup is a menu; Docs has a dialog with OK and Cancel.
- How bad: **confusing**.
- Smallest fix: one written rule. A list of choices that applies at once is a menu. Anything with a field or anything to read is a dialog. Move About, Page setup, Header and footer, the GitHub form and Checking settings to the dialog. Keep the one-field boxes (Link, Bookmark, Restart) as one shared box that opens at the caret.

### 3.2 Confirm and cancel are placed differently in each
- Dialogs: quiet word left, filled button right.
- GitHub form: outlined "Connect" left, "Back" right. Picture: `repo.png`.
- Field boxes: one text button ("Set", "Add", "Restart"), no cancel.
- Comment: "Keep" then "Cancel", both plain.
- Home list delete: "Delete Untitled" then "Keep it", as menu lines.
- Version history: outlined "Restore this version" at the top left.
- Smallest fix: primary filled at the right, cancel quiet to its left, wherever a pair exists.

### 3.3 Find and replace
- **The selection bar pops up on every match.** Find selects the match, so the bold and heading bar appears under it and covers the next line. `src/quire/find.ts`, `src/quire/select-bar.ts`. **wrong**. Fix: no selection bar while find is open. Picture: `dlg-replace.png`.
- **Ctrl+H puts the caret in "Replace with".** Docs puts it in Find. **rough**.
- **"Find" opens with the replace row if it was open last time.** **rough**.
- **Names.** The tooltip is "Find and replace (Ctrl+F)"; Edit has Find on Ctrl+F and Find and replace on Ctrl+H. The steps are "The one before" and "The next"; Docs says Previous and Next. Two controls are called "Replace". **rough**.
- The bar opens over the document's title. **taste**.
- These work: count, case, whole word, Enter and Shift+Enter, Escape with the match left selected.

### 3.4 Word count
- A dialog with Words, Characters, Characters no spaces and Paragraphs, plus a Selected column when words are selected. Escape returns to the text.
- Tools shows the count as a dead first line ("13 words") above "Word count". It looks pressable. **rough**.

### 3.5 Version history
- The panel starts above the bar and covers Find, the three dots and the microphone. The Picture panel starts below the bar. **rough**.
- Each line is a time and "+3 −0". The preview shows that version's text with no marks for what changed. Docs colours the changes. **confusing**. Fix: tint added lines.
- Escape from a preview closes the whole panel. The back arrow goes to the list. **rough**.
- The title is "History"; the menus say "Version history"; the close button is "Close the history". **rough**.

### 3.6 Page setup
- A menu with three quiet headings (Paper, Which way up, Margins). It applies at once. The headings are indented differently from the lines. What is chosen is violet only. Picture: `sub-file-page.png`.
- "Which way up" is Docs' "Orientation". Margins are three named sizes with no numbers. **taste**.
- Docs has a dialog with OK and Cancel. Here a mis-press changes the paper at once.

### 3.7 Keyboard shortcuts
- A dialog with a search and sections by menu.
- Escape with words in the search clears the search first. Every other dialog closes on the first Escape. **rough**.
- The placeholder is "Search the shortcuts and typing". "Typing" means Markdown typed as you go. **taste**.
- Mac symbols again (1.6).

### 3.8 About
- A menu under Tools with a name, a sentence and two links. Focus stays in the text. **rough**. Make it a dialog.

### 3.9 Dictation's first launch
- "Choose" grows into three cards and the button becomes "Download and start". "Not now" cancels. Escape returns to the microphone button.
- **All three cards end with "Runs on the processor"**, including "Accurate: For a computer with a graphics card". **confusing**. Fix: say it once under the cards.
- The settings menu names the models "Parakeet Ultra", "Parakeet Redux", "Moonshine tiny" and ends with a licence paragraph. **taste**. Move the credits to About.

### 3.10 "Not saved" and the conflict panel (read in the code, not reached)
- Not saved (`askUnsaved`, `src/quire/editor.ts` line 979) has four ways out in two styles. "Try again" is filled and "Stay" is quiet beside it. "Download a copy" and "Leave without saving" are links inside the text. A destructive choice drawn as a link is easy to miss and easy to hit. **rough**. Fix: all in the button row, with "Leave without saving" quiet at the far left.
- Conflict (`src/quire/conflict.ts`): "Keep mine", "Take theirs", "See both", and a close button named "Not now". Clear.

### 3.11 The documents list under the name
- Picture: `dlg-documents.png`. A "Name" field; "This browser" as a heading with the documents; "Places" with "This browser" again as a line; then "Open a file", "Open a file to write in place", "Open a folder", "Connect a repository"; then "Google Drive is not set up yet."
- **Rename has no button, and Enter leaves the menu open with the keyboard on the page body.** The name does change. **wrong**. Fix: Enter renames, closes, and returns the caret to the text.
- **"This browser" is there twice.** **confusing**.
- **"Places" mixes places with actions.** **confusing**. Fix: "Open from" with This browser, Computer file, Folder, GitHub.
- **"Open a file" against "Open a file to write in place".** The difference (a copy or the real file) cannot be read from the words. **confusing**. Fix: "Open a copy" and "Open and save to the file".
- **The Drive note is a sentence for the owner, shown to everyone.** **rough**. Leave it out until Drive is set up.

### 3.12 The GitHub form
- It opens inside the documents menu: five fields, the last a secret token, then a four-line paragraph.
- The paragraph says "press Forget below", and there is no Forget button until connected. **wrong** wording.
- The buttons are in the reverse of the dialogs' order (3.2).
- The selection bar stayed drawn beside the form in my run. **rough**. Picture: `repo.png`.

### 3.13 Checking
- **Tools goes to settings and the bar goes to results.** Tools, Checking opens a menu of 38 tick boxes that runs off the bottom. The bar's count button opens the list of findings, with "Settings" at its foot. **confusing**. Fix: Tools, "Spelling and grammar" opens the results.
- The list repeats the same misspelling once per place ("teh" three times). **rough**. Group them.
- The count's glyph is four tiny dots and a number. **rough**.
- The popover on a misspelt word is clear. For "teh" it offers "ten" before "the". **taste**.

### 3.14 The home list
- Row menu: Open, Rename, Duplicate, Delete, then "Delete Untitled" and "Keep it" in the same menu. A clear confirm pattern to reuse.
- Labels are all lower case here and sentence case in the editor. **taste**.
- The palette's round button shows on the home list, where the notes say the palette opens only from the writing. **rough**.
- "connect a repository" showed nothing within 0.7 s in one try. Worth a check.

---

## 4. The bar

### 4.1 Three magnifying glasses, three meanings
- Far left of the bar: "Search the menus". Right of the bar: "Find and replace". Bottom left of the window: "Commands". At 390 wide the first two are in one row.
- How bad: **confusing**.
- Smallest fix: one command search (the palette) and one find. Give the palette's button another sign.

### 4.2 Search the menus and the palette are two tools for one job
- Both search every menu line by name. The palette also offers headings and what fits the cursor. Keep the palette. Bind Alt+/ (Docs' "Search the menus") to it.

### 4.3 The text size field
- **Clicking the number does not select it.** Typing 17 into "12" made "1172". Enter clamped it to 96 and the word became eight times its size. `sizeField`, `src/quire/bar.ts` line 769. **wrong**. Fix: `sizeField.select()` on focus.
- **Three scales.** Format's "Text size ›" offers only 10, 12, 15, 18, 24. The field takes any number. Plus and minus step by one. **rough**.

### 4.4 Colour and highlight
- Each is a list of 13 named lines with a dot. "Pink" is there twice. Docs uses a grid of swatches. **rough**. Fix: a grid with names as tooltips; rename one pink.
- The text colour button shows the current colour. The highlight button does not. **taste**.

### 4.5 The style box
- It says "Paragraph". Format says "Normal text". **rough**. Keep "Normal text".
- Its lines are not drawn in their own style. **taste**.
- In a callout it says "Quote". In a list it says "Paragraph".
- "Title" moves the caret to the title line and does not restyle the paragraph. Nothing tells the writer. **confusing**. Fix: say so in the status line, or leave Title out of the list.

### 4.6 Tooltips
- **Some carry their shortcut and some do not, though all have one.**
- With: Bold, Italic, Underline, Strikethrough, Link, Print, Undo, Redo, Find, dictation.
- Without: Checklist, Bulleted list, Numbered list, the four alignments, Indent, Clear formatting, Zoom.
- **rough**. Fix: build every tooltip from `keysFor`.
- "Paint format: copy the formatting of the selection, then select where it goes" is a sentence among single words. **taste**.
- I could not see tooltips drawn. Labels were read from the page.

### 4.7 What folds, and where it goes
- At 1300 wide Print, Spelling, Paint format, Zoom, Link, Line spacing, Indent and Clear formatting are already in the three dots. **rough**. The decided single buttons will free room; check that Link and Zoom come back first.
- The fold order (`FOLDS`, `src/quire/bar.ts` line 566) drops Zoom and Link before the four alignment buttons.
- **The three dots hold two unrelated things**: tools that did not fit, and document commands (Show the Markdown, Version history, dictation, Download, About). Its contents change with the window's width. **confusing**. Picture: `bar-dots.png`. Fix: the dots hold only what did not fit.
- **At 390 wide the bar slides sideways and starts with the least used tools.**
- The first screen is Search the menus, Undo, Redo, Print, Spelling, a cut sliver of Paint format, then Find, dots, microphone.
- Style, Bold, Italic and the lists are off to the right. Only the sliver shows that the row slides.
- The dots there list only the document commands, so the formatting tools look gone.
- **wrong** on a phone. Fix: put Style, Bold, Italic and lists first, and fade the row's right edge. Picture: `n390-sheet.png`.

### 4.8 Pressed states
- Bold, lists and alignment show pressed correctly. The style box, typeface and size follow the cursor. Paint format shows pressed while it waits.

### 4.9 The status at the right
- The status word is also where messages go. A message stays until the next save; the paste message was still there two commands later. **rough**. Fix: clear a message after a few seconds.
- "1 places are selected". `src/quire/editor.ts` line 617.

### 4.10 A new document scrolls with nothing in it
- An empty document is 911 px tall in an 800 px window. The page scrolls 111 px for no reason. **rough**. Fix: `min-height` of the window less the top.

---

## 5. Selection

### 5.1 The bar over selected words covers the next line
- With text above the selection, the bar goes below and sits on the following line. `sideFor`, `src/quire/select-bar.ts` line 38, goes above only when the gap above is empty, which in running text it never is. **rough**. Fix: sit it above, over the line already read. Picture: `sel-comment2.png`.

### 5.2 What is in the bar
- Bold, Italic, Strikethrough, Inline code, Link, then heading, quote, list. No Underline, no Comment. The main bar has Underline and no Inline code. **rough**. Fix: Bold, Italic, Underline, Strikethrough, Link, Comment, then the three block buttons.
- The heading button makes Heading 2. The "H" icon does not say which level.
- Each button toggles and the selection is kept.

### 5.3 Right-click
- On text: nothing of mdQuire's. Docs has Cut, Copy, Paste, Paste without formatting, Comment, Insert link. **confusing** for a Docs writer.
- On a picture: mdQuire's menu. In a table: nothing.
- Smallest fix: a right-click menu on text from lines that already exist (Comment, Link, Bold, Italic). Leave the browser's menu on Shift+right-click.

### 5.4 Select all matching text
- It selects every place the same words appear. Case matters: with "Alpha" selected, "alpha" is not taken and the status says "1 selected". In Docs the line of that name selects text with the same formatting (from memory). **confusing**. Fix: name it "Select all occurrences" and ignore case.
- With nothing selected it reports "1 selected". **rough**. Grey the line out.

### 5.5 Paste without formatting
- From the menu it needs clipboard permission. Without it the only sign is the status word "Press Ctrl+Shift+V". **rough**. Fix: show the message at the caret.

---

## 6. The palette and the slash

### 6.1 The palette
- Two taps of Ctrl or the round button open it from the bottom left with the caret in its field. Typing filters, Enter runs, Escape gives the caret back. With words selected it leads with Link, Comment, Bold. All of this works.
- A command that opens a menu sends it to the top of the window. **rough** (1.3).
- The empty list ends with "All documents" and "New document". **taste**.
- Shortcuts are Mac symbols (1.6).

### 6.2 The slash
- "/" on an empty line shows five and "More". Typing narrows. A slash mid-line stays a slash. These work.
- **"More" grows the list upward over the top bar.** It ran from y 4 to y 566, over the site's name and the menus, with its last line cut. **rough**. Fix: grow downward from the caret and never above the bar. Picture: `slash-more.png`.
- **The slash and Insert do not match.**
- "Divider" here is "Horizontal line" in Insert.
- The slash has Quote, Subtext and headings, which Insert lacks.
- Insert has Footnote, Date, Special characters, Table of contents, Bookmark, Comment and Link, which the slash lacks.
- "/tab" finds Table only; the palette finds Table and Table of contents.
- **confusing**. Fix: the slash lists everything in Insert plus the block styles, by Insert's names.
- The hint on an empty line says "Type / for blocks". "Blocks" is jargon.

---

## 7. Wording

| Where | Now | Problem | Suggest |
|---|---|---|---|
| View | No page | sounds like the document is gone | Dark (or Pageless) |
| View | Light paper | a noun among states | Paper |
| View | Page view | Docs' word is known | Print layout |
| View | The Markdown beside the page | a sentence | Show Markdown |
| View | Zoom back to the usual | a sentence; the child says "Usual size (100%)" | 100% |
| View, Insert | Notes, Note / Comment | two words | Comment, Comments |
| File | All documents / Documents | one word apart, two places | Home / Open |
| File | Open a file to write in place | not readable | Open and save to the file |
| File | Connect a repository | jargon | Open from GitHub |
| File | Download / Download as Markdown / Download as › | three lines | Download › only |
| Download as | PDF, through the print dialog | a sentence | PDF (print) |
| Download as | mdQuire | the app's name as a file kind | mdQuire document (.quire) |
| Page setup | Which way up | Docs' word is known | Orientation |
| Format | Marked | sits beside Highlight, a different thing | fold into Highlight |
| Format | Subtext | Discord's word | Small text |
| Format | Typeface | Docs says Font | Font |
| Format | Text color / Centre / Capitalisation | American and British mixed | pick one |
| Format, lists | Written with a dash / star / plus; "All three are drawn alike, as Markdown reads them" | explains the file format in a menu | Bullet character: - * + |
| Tools | Typed signs, -> to → | reads as code | Replace -> with → as you type |
| Tools | Forget what I use most | unclear what is forgotten | Reset slash suggestions |
| Tools | Checking | Docs: Spelling and grammar | Spelling and grammar |
| Bar | Paragraph | Format says Normal text | Normal text |
| Find | The one before / The next | odd | Previous / Next |
| Find | Replace (arrow) and Replace (button) | same name twice | Show replace / Replace |
| Link | Set | Docs: Apply | Apply |
| Comment | Keep | Docs: Comment | Comment |
| Picture | Picture to the left / in the centre / to the right | siblings say Align left | Align left / Centre / Align right |
| Picture | Its own size / Own size | odd | Original size |
| Picture | Take the picture away (label) with "Remove" (shown) | two phrasings | Remove |
| Fold | Starts closed; press to start it open | jargon | Closed for readers / Open for readers |
| Callout | Press for another kind of callout | describes a cycle | Change type |
| Code | language (placeholder) | unlabelled, hidden | Plain text ▾ |
| Maths | Maths, written below in TeX | jargon | Type a formula below |
| Diagram | Shown as code: mdQuire draws flowcharts only | wrong for a broken flowchart | Could not draw this |
| Empty line | Type / for blocks | jargon | Type / to insert |
| Documents | Google Drive is not set up yet. | owner's note shown to all | remove |
| GitHub | press Forget below | no such button yet | remove until connected |
| Status | 1 places are selected | grammar | 1 place selected |
| History | History / Close the history | menus say Version history | Version history / Close |
| Dictation | Runs on the processor (three times) | repeats, contradicts a card | once, below |
| Shortcuts | Search the shortcuts and typing | "typing" unclear | Search shortcuts |

---

## 8. Consistency across the whole

### 8.1 Fields inside the document throw the keyboard away on Enter
- Picture caption, picture description, code language, fold summary and the name field all blur to the page body on Enter. Five places, one cause. **wrong**. Fix in one helper: after Enter, focus goes to the surface with the caret restored, or to the thing the field belongs to.

### 8.2 Floating strips cover text
- Table strip, picture strip, selection bar, link box, find bar. Each sits on a line of the writer's text. **rough**. Fix: one shared placement rule (`placeNear` in `ui.ts` exists): prefer a real gap, else above, never over the selection or the line being typed.

### 8.3 What "on" looks like
- Menu lines: violet text, no tick. Bar buttons: filled square. Panel buttons: filled square, except Wrap, whose label says "Off". Checking: real tick boxes. Page numbers: violet text.
- Fix: a tick in menus, the filled square for buttons, no state written as a label.

### 8.4 Corner radius and type size (measured)
- Radius: menus about 12 px, find bar 18, table strip 19.7, selection bar 20.5, picture and history panels about 20, language field 5.7, fields full pills.
- Type: selection bar 15.6 px, table strip 18.5, language field 12.3.
- **taste**. Three radii would do.

### 8.5 Escape
- Menu: closes, caret back in the text.
- Child menu: closes everything.
- Dialog: closes.
- Shortcuts dialog with words typed: clears first.
- History preview: closes the whole panel.
- Picture panel: closes the panel, then a second Escape lets the picture go.
- Find: closes, match stays selected.
- Fix: Escape always steps back exactly one level.

### 8.6 Motion and the standing rules
- I did not measure animation. From positions, classes and code, menus, dialogs, the palette and the picture panel grow from their trigger.
- Three things do not: the left-offset children (1.3), Search the menus opened from Tools, and a palette command that opens a menu.
- Opening a menu never moved the page in my runs. The empty document's needless scroll (4.10) is the one place the page can slide.
- No glow seen.

---

## 9. The ten changes that would most improve how it feels, in order

1. **Make a menu own the keyboard while it is open** (1.1).
2. **Rebuild View as three ruled groups with ticks**, one Zoom line, and no doubles inside Zoom (1.4).
3. **Fix the fields that drop the keyboard on Enter**, in one helper (8.1).
4. **Select the number when the size field is clicked** (4.3).
5. **One placement rule for the floating strips**, and no selection bar while find is open (8.2, 3.3).
6. **Escape and Left step back one level from a child menu**, and every child opens from the word pressed (1.2, 1.3).
7. **Code blocks keep blank lines and show their language as a menu; the callout kind becomes a menu** (2.3, 2.4).
8. **Tables get row above, column left and delete table in a right-click menu**, and dead buttons are disabled (2.1).
9. **Links: add `https://`, open Ctrl+K at the words, show a card on a link** (2.16).
10. **One search and one find, and one rule for dialog against menu**, starting with About, Page setup and Header and footer (4.1, 4.2, 3.1).

After these: the phone bar's order (4.7), the wording table (7), Mac symbols on other systems (1.6).

---

## 10. Inconsistencies

| The thing | Variants found | Keep |
|---|---|---|
| A line that leads to more | replaces the menu under the word; opens left of the word; opens at the far right; opens at the top from the palette | a child that opens from the line or word pressed, Escape steps back |
| Something to fill in | modal dialog; menu with a form; side panel; pill box over the bar; field inside the text | dialog for forms, one field box at the caret for a single value |
| Confirm and cancel | filled right with quiet left; outlined left with plain right; single text button; two plain words; two menu lines | filled primary at right, quiet cancel to its left; the home list's "Delete X / Keep it" for deletes |
| "On" in a menu | violet text only; violet text and icon | a tick |
| A switch in a panel | pressed square button; button labelled "Off" | pressed square |
| Choosing one of a few | menu of lines; row of buttons; press to cycle (callout); native datalist (code language) | menu for five or more, row of buttons for four or fewer, never a cycle |
| Shortcut text | Mac symbols in menus, palette, shortcuts dialog; "Ctrl+B" in tooltips and status; "Ctrl+P" in one menu line | words on Linux and Windows, symbols on a Mac |
| Strikethrough keys | Alt+Shift+5 (menu); Ctrl+Shift+X (tooltip) | Alt+Shift+5 shown, both work |
| Normal paragraph | "Paragraph" (bar); "Normal text" (Format) | Normal text |
| Horizontal rule | "Horizontal line" (Insert); "Divider" (slash) | Horizontal line |
| Notes on text | "Comment" (Insert, palette); "Note", "Notes" (panel, View) | Comment |
| Markdown view | "The Markdown beside the page" (View); "Show the Markdown" (dots) | Show Markdown |
| 100% zoom | "Zoom back to the usual"; "Usual size (100%)"; "100%" | 100% |
| Checking | "Checking" (Tools, opens settings); "Spelling and checking" (bar, dots); count button (opens results) | Spelling and grammar, opens results |
| Version history | "Version history" (menus); "History" (panel); "Close the history" | Version history |
| Alignment words | "Picture to the left"; "Align left"; "Align the column left" | Align left, Centre, Align right |
| Remove | "Remove"; "Take the picture away"; "Remove this row"; "Delete" (home list); bin icon | Remove for things in the text, Delete for documents |
| Magnifying glass | Search the menus; Find and replace; Commands | Find only; another sign for commands |
| Where link opens | in the selection bar at the words; under the three dots | at the words |
| Panel start | history from the window's top; picture panel below the bar | below the bar |
| Tooltip shortcut | present on some buttons; absent on others that have one | always present |
| Tooltip length | one or two words; one full sentence (Paint format) | one or two words |
| Case of labels | sentence case in the editor; lower case on the home list | sentence case, or lower case on the home list on purpose |
| Spelling | Centre, Capitalisation; Text color, "November 13, 2026" | one |
| Corner radius | 5.7, 12, 18, 20, pill | three steps |
| Escape | one level; all levels (child menu, history preview); clears first (shortcuts search) | always one level |
| Icons in a row of actions | words and a bin (comment card); icons and "Own size" (picture strip); icons and "A→Z" (table strip) | all icons with tooltips, or all words |

---

## 11. What I could not reach or test

- **Tooltips as drawn.** The driver has no hover. Labels were read from `aria-label` and `title`.
- **The browser's own right-click menu on text.** Headless shows none. I confirmed only that mdQuire opens nothing of its own on text or in a table.
- **Print and PDF.** The print dialog is the browser's.
- **"Not saved" and the conflict panel.** Not reached. Wording and layout were read in `src/quire/editor.ts` and `src/quire/conflict.ts`.
- **Google Drive.** Only the "not set up yet" sentence. The sign-in and passphrase dialog were not opened; `/mdquire-drive-try/` was not visited.
- **Dictation past the first dialog.** Cancelled before any download. Recording and "Custom words" were not seen.
- **Open a file to write in place, Open a folder.** System pickers. Not driven.
- **GitHub.** The form was seen. No connection was tried.
- **Definition list keys and the checklist's box.** My run lost keyboard focus after the fold summary's Enter (8.1), and the later steps typed nowhere. Not re-run.
- **Ctrl+K with nothing selected.** The box opened; what it inserts was not captured.
- **Dragging a picture to the very end.** One try landed one block short. Not repeated.
- **"connect a repository" on the home list.** Nothing showed within 0.7 s in one try. It works from the documents menu.
- **Paste and dropping a picture file.** No clipboard or file drag in the driver.
- **Animation timing and easing.** Not measured.
- **The site's light theme.** I checked Light paper and page view inside the dark theme only.
- **`.md` and `.mdx` documents.** Everything was done in a `.quire` document. The Markdown-only menu differences were read in code.
- **Firefox and Safari.** Chromium only.
- **The in-progress branch** (File, Edit, full-screen, word-counter, preferences, help). Not looked at. Findings are against `main` as built.
