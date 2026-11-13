# What Google Docs' menus have that mdQuire does not (13 Nov 2026)

Marks: **S** makes sense for a Markdown editor and is small; **B** makes sense and is big; **X** does not fit.
Nothing here is built. Things mdQuire already has are left out.

## File
- New document, Open (as menu lines; the shelf does it now) : S
- Make a copy : S (the shelf has copyName; a menu line is missing)
- Share, Email, Publish to the web : B (needs a server)
- Rename (a menu line; the title and the trail's name do it now) : S
- Move, Add shortcut to Drive, Move to bin : X (Drive's)
- Offline, Details (a File line showing the details panel) : S
- Language : S (spelling's dialect lives in Checking)
- Approvals, Email collaborators : X

## Edit
- Cut, Copy, Paste as menu lines (keys work) : S
- Delete : S
- Select all matching text : S
- Paste from the clipboard history, Web clipboard : X

## View
- Mode: Editing / Suggesting / Viewing : B (Suggesting is tracked changes)
- Show print layout (we have Page view), Show ruler : S for a ruler in page view
- Show equation toolbar : S
- Show non-printing characters : S
- Full screen (hide the menus) : S
- Show word count while typing (a small counter, as Docs' Ctrl+Shift+C box option) : S

## Insert
- Drawing : B
- Chart (from Sheets) : X; a chart from a table : B
- Emoji (a picker beyond the typed list) : S
- Smart chips (people, dates, files, dropdowns) : B
- Building blocks (meeting notes, email draft, product roadmap) : S as templates on the shelf
- Equation (an inline equation; inline maths was taken out for `$`) : S as a menu line that inserts a maths block, done; inline maths : B and collides with `$`
- Watermark : X
- Headers and footers, page numbers for Markdown files : X (a .quire document has them)
- Bookmark (a link to a place in the document) : S
- Break: section break, column break : X (Markdown has no sections or columns)

## Format
- Text: superscript, subscript, size, capitalisation (lower, UPPER, Title Case) : capitalisation S
- Paragraph styles: Title, Subtitle as styles; "Update Normal text to match"; save as default styles : S for Title/Subtitle, B for named styles
- Align and indent: indentation options (first line, hanging) : X in Markdown, S for .quire
- Line and paragraph spacing: space before and after : S for .quire
- Columns : X
- Bullets and numbering: choose the marks (arrows, dashes, letters), restart numbering, continue previous list : S (restart and continue map to Markdown's start numbers)
- Table: table properties (borders, cell colour), merge cells, sort : sort S; merge and colours X in Markdown
- Image: crop, alt text (we have alt), image options, replace image : crop S for .quire, replace S
- Borders and lines, shading : X
- Clear formatting : done

## Tools
- Spelling and grammar: grammar check : B (the owner asked for a better speller; coming)
- Word count with options (pages, characters) : done as Ctrl+Shift+C; pages in page view : S
- Review suggested edits : B (with Suggesting)
- Compare documents : S (version history already diffs)
- Citations : B
- Explore, Linked objects, Dictionary : Dictionary S, the rest X
- Translate document : X
- Voice typing : done (dictation)
- Notification settings, Preferences (substitutions list, automatic lists on or off) : S: a list of what typing turns into, with switches (vocabulary.ts is the table)
- Accessibility settings : S
- Keyboard shortcuts : done (Ctrl+/)

## Extensions, Help
- Add-ons, Apps Script : X
- Help, Training, Updates : S for a short help page; X for the rest
