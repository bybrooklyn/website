// A document as a Word file, written from scratch. A .docx is a zip of a few XML files (the zip is
// zip.ts, the same that holds a `.quire` document); this writes the smallest set Word reads:
//
//   [Content_Types].xml            what each part is
//   _rels/.rels                    where the document is
//   word/document.xml              the text: headings, paragraphs, lists, quotes, code, tables, pictures
//   word/styles.xml                Normal, Heading 1 to 6, Quote, Code, Caption, Hyperlink
//   word/numbering.xml             bullets and numbers, a list of each kind numbered afresh
//   word/_rels/document.xml.rels   the styles, the numbering, each link's address and each picture
//   word/media/                    the pictures, as they are
//
// Marks are bold, italic, underline, strike and code; color and size are kept where they can be
// said in Word's terms. A footnote is written as a raised number and its text as a paragraph at the
// end, not as one of Word's own footnotes. A picture Word cannot show (SVG, WebP, AVIF) is written
// as its alt text. Nothing here has been opened in Word itself: the tests unzip the file and read
// the XML.

import { runsText, type Align, type Block, type Document, type Leaf, type Page, type Run } from "./document";
import type { Picture } from "./export";
import { isContentsMark, slug } from "./inserts";
import { isPageBreak } from "./document";
import { emojiOf } from "./emoji";
import { writeZip } from "../core/zip";
import { safeAddress } from "./html";

/** Text made safe in XML: escaped, and without the characters XML 1.0 does not allow at all (a form feed from a PDF, a vertical tab from Word), which make Word call the file unreadable. */
const xml = (text: string) =>
    text
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
        .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const RELS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** The pictures Word shows, by type, with the ending each is kept under. */
const SHOWN: Record<string, string> = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/bmp": "bmp" };

/** A paper's size in twentieths of a point, as Word measures a page. */
const PAPER: Record<Page["size"], [number, number]> = { A4: [11906, 16838], Letter: [12240, 15840], A5: [8391, 11906] };

/** A size as the editor keeps it ("1.25em", "18px", "15pt") in Word's half points, the text's own being 12 points. */
export function halfPoints(size: string): number | undefined {
    const value = parseFloat(size);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    const points = size.endsWith("pt") ? value : size.endsWith("px") ? value * 0.75 : size.endsWith("%") ? (value / 100) * 12 : value * 12;
    // Word's sizes run from 1 to 1638 points; a size from a hostile file is held inside them
    return Math.min(3276, Math.max(2, Math.round(points * 2)));
}

/** What the writer is given beside the document: its pictures, and a way to turn a CSS color into six hex digits. */
export interface DocxOptions {
    pictures?: Map<string, Picture>;
    hex?: (color: string) => string | undefined;
    title?: string;
}

/** Writes a document as the bytes of a .docx file. */
export async function docx(doc: Document, options: DocxOptions = {}): Promise<Uint8Array> {
    const page = doc.quire?.page ?? { size: "A4", orientation: "portrait", margins: 25 };
    const [short, long] = PAPER[page.size];
    const [width, height] = page.orientation === "landscape" ? [long, short] : [short, long];
    const margin = Math.round(page.margins * 56.7);
    // the text's width in EMU, the unit a picture is sized in (a twip is 635 of them)
    const room = (width - margin * 2) * 635;
    const rels: string[] = [];
    const media: { name: string; data: Uint8Array }[] = [];
    const nums: string[] = [];
    let next = 3;
    let drawing = 1;
    let bookmark = 1;
    const seen = new Map<string, number>();
    const anchors = new Map<string, string>();
    const anchorOf = (id: string) => `h_${id.replace(/[^A-Za-z0-9]/g, "_")}`.slice(0, 40);
    const hex = (color: string) => {
        const plain = /^#?([0-9a-f]{6})$/i.exec(color.trim())?.[1] ?? /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color.trim())?.slice(1).map((digit) => digit + digit).join("");
        return (plain ?? options.hex?.(color))?.replace(/^#/, "").toUpperCase();
    };
    const link = (href: string) => {
        const id = `rId${next++}`;
        rels.push(`<Relationship Id="${id}" Type="${RELS}/hyperlink" Target="${xml(href)}" TargetMode="External"/>`);
        return id;
    };

    // ---- runs ----
    const leaf = (run: Leaf, extra = ""): string => {
        if (run.kind === "break") return "<w:r><w:br/></w:r>";
        if (run.kind === "image") return run.alt ? `<w:r><w:t xml:space="preserve">[${xml(run.alt)}]</w:t></w:r>` : "";
        if (run.kind === "footnote") return `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t>${xml(run.label)}</w:t></w:r>`;
        if (run.kind === "html") return run.html.trim().startsWith("<") ? "" : `<w:r><w:t xml:space="preserve">${xml(run.html)}</w:t></w:r>`;
        if (run.kind === "emoji") return `<w:r><w:t xml:space="preserve">${xml(emojiOf(run.name) ?? `:${run.name}:`)}</w:t></w:r>`;
        const props: string[] = [];
        // inline maths is written as its TeX source between dollars, in the code face: Word is given the words, not a layout
        const maths = run.marks.includes("math");
        if (extra) props.push(extra);
        if (run.marks.includes("code") || maths) props.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
        if (run.marks.includes("bold")) props.push("<w:b/>");
        if (run.marks.includes("italic")) props.push("<w:i/>");
        if (run.marks.includes("strike")) props.push("<w:strike/>");
        const colour = run.color && hex(run.color);
        if (colour) props.push(`<w:color w:val="${colour}"/>`);
        const size = run.size && halfPoints(run.size);
        if (size) props.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
        if (run.marks.includes("mark")) props.push('<w:highlight w:val="yellow"/>');
        // Word reads these in the order its schema gives: underline before shading
        if (run.marks.includes("underline")) props.push('<w:u w:val="single"/>');
        const mark = run.highlight && hex(run.highlight);
        if (mark) props.push(`<w:shd w:val="clear" w:color="auto" w:fill="${mark}"/>`);
        if (run.marks.includes("sup") || run.marks.includes("sub")) props.push(`<w:vertAlign w:val="${run.marks.includes("sup") ? "superscript" : "subscript"}"/>`);
        const parts = (maths ? `$${run.text}$` : run.text).split("\n");
        const text = parts.map((part) => `<w:t xml:space="preserve">${xml(part)}</w:t>`).join("<w:br/>");
        return `<w:r>${props.length ? `<w:rPr>${props.join("")}</w:rPr>` : ""}${text}</w:r>`;
    };
    const runs = (list: Run[]): string =>
        list
            .map((run) => {
                if (run.kind !== "link") return leaf(run);
                const inner = run.runs.map((each) => leaf(each, '<w:rStyle w:val="Hyperlink"/>')).join("");
                if (run.href.startsWith("#")) return `<w:hyperlink w:anchor="${xml(anchors.get(run.href.slice(1)) ?? anchorOf(run.href.slice(1)))}">${inner}</w:hyperlink>`;
                // only a link to the web or an email address is a link in the Word file: never a file on the disk, a share or a script
                const href = safeAddress(run.href);
                return href !== undefined && /^(https?:|mailto:)/i.test(href.trim()) ? `<w:hyperlink r:id="${link(href.trim())}">${inner}</w:hyperlink>` : inner;
            })
            .join("");

    // ---- paragraphs ----
    const JC: Record<Align, string> = { left: "left", center: "center", right: "right", justify: "both" };
    const paragraph = (content: string, props: { style?: string; align?: Align; list?: { level: number; num: number }; indent?: number; spacing?: number; border?: boolean } = {}) => {
        const pr: string[] = [];
        if (props.style) pr.push(`<w:pStyle w:val="${props.style}"/>`);
        if (props.list) pr.push(`<w:numPr><w:ilvl w:val="${props.list.level}"/><w:numId w:val="${props.list.num}"/></w:numPr>`);
        if (props.border) pr.push('<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>');
        if (props.spacing && Number.isFinite(props.spacing)) pr.push(`<w:spacing w:line="${Math.round(Math.min(10, Math.max(0.5, props.spacing)) * 240)}" w:lineRule="auto"/>`);
        if (props.indent) pr.push(`<w:ind w:left="${props.indent}"/>`);
        if (props.align) pr.push(`<w:jc w:val="${JC[props.align]}"/>`);
        return `<w:p>${pr.length ? `<w:pPr>${pr.join("")}</w:pPr>` : ""}${content}</w:p>`;
    };

    const picture = (src: string, alt: string, share?: number): string | undefined => {
        const found = options.pictures?.get(src);
        const ending = found && SHOWN[found.type];
        if (!found || !ending) return undefined;
        const id = `rId${next++}`;
        const name = `image${media.length + 1}.${ending}`;
        media.push({ name, data: found.bytes });
        rels.push(`<Relationship Id="${id}" Type="${RELS}/image" Target="media/${name}"/>`);
        const own = found.width * 9525;
        const cx = Math.round(share !== undefined ? (room * share) / 100 : Math.min(own, room));
        const cy = Math.round((cx * found.height) / Math.max(1, found.width));
        const number = drawing++;
        return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${number}" name="Picture ${number}" descr="${xml(alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${number}" name="${name}" descr="${xml(alt)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    };

    /** A new numbering for one list, a bulleted or a numbered one, starting where it starts. */
    const numbering = (numbered: boolean, start: number) => {
        const id = nums.length + 1;
        nums.push(`<w:num w:numId="${id}"><w:abstractNumId w:val="${numbered ? 1 : 0}"/>${numbered ? `<w:lvlOverride w:ilvl="0"><w:startOverride w:val="${start}"/></w:lvlOverride>` : ""}</w:num>`);
        return id;
    };

    const footnotes: string[] = [];
    const blocks = (list: Block[], level: number, indent: number, style?: string): string[] =>
        list.flatMap((block): string[] => {
            switch (block.kind) {
                case "paragraph":
                    return [paragraph(runs(block.runs), { style, align: block.align, indent, spacing: block.spacing })];
                case "heading": {
                    const id = slug(runsText(block.runs).replace(/￼/g, "").trim(), seen);
                    const name = anchorOf(id);
                    anchors.set(id, name);
                    const mark = bookmark++;
                    return [paragraph(`<w:bookmarkStart w:id="${mark}" w:name="${xml(name)}"/>${runs(block.runs)}<w:bookmarkEnd w:id="${mark}"/>`, { style: `Heading${block.level}`, align: block.align, spacing: block.spacing })];
                }
                case "list": {
                    // a definition list: each term in bold, each of its definitions indented under it
                    if (block.style === "definition")
                        return block.items.flatMap((item) =>
                            item.blocks.flatMap((child, index) =>
                                index === 0 && (child.kind === "paragraph" || child.kind === "heading") ? [paragraph(runs(child.runs.map((run) => (run.kind === "text" ? { ...run, marks: [...run.marks, "bold" as const] } : run))), { style, indent })] : blocks([child], level, indent + 720, style),
                            ),
                        );
                    const num = numbering(block.style === "number", block.start);
                    return block.items.flatMap((item) =>
                        item.blocks.flatMap((child, index) => {
                            if (child.kind === "list") return blocks([child], level + 1, indent, style);
                            const box = item.checked === undefined || index > 0 ? "" : `<w:r><w:t xml:space="preserve">${item.checked ? "☒" : "☐"} </w:t></w:r>`;
                            if (index === 0 && (child.kind === "paragraph" || child.kind === "heading")) return [paragraph(box + runs(child.runs), { style: "ListParagraph", list: { level, num } })];
                            return blocks([child], level, 720 * (level + 1), style);
                        }),
                    );
                }
                case "quote": {
                    // a callout's kind and a folding section's summary head its blocks, in bold
                    const head = block.callout !== undefined ? `${block.callout.charAt(0).toUpperCase()}${block.callout.slice(1).toLowerCase()}${block.title ? `: ${block.title}` : ""}` : block.details ? block.details.summary : undefined;
                    const top = head !== undefined ? [paragraph(`<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xml(head)}</w:t></w:r>`, { style: block.details ? style : "Quote", indent })] : [];
                    return [...top, ...blocks(block.blocks, level, block.details ? indent + 360 : indent, block.details ? style : "Quote")];
                }
                case "code":
                    return [paragraph(`<w:r>${block.code.split("\n").map((line) => `<w:t xml:space="preserve">${xml(line)}</w:t>`).join("<w:br/>")}</w:r>`, { style: "Code", indent })];
                case "table": {
                    const columns = block.header.length;
                    const each = Math.floor((width - margin * 2) / Math.max(1, columns));
                    const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
                    const cell = (cells: Run[], column: number, head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${each}" w:type="dxa"/></w:tcPr>${paragraph(head ? runs(cells.map((run) => (run.kind === "text" ? { ...run, marks: [...run.marks, "bold" as const] } : run))) : runs(cells), { align: block.align[column] ?? undefined })}</w:tc>`;
                    const rows = [`<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.header.map((cells, column) => cell(cells, column, true)).join("")}</w:tr>`, ...block.rows.map((row) => `<w:tr>${block.header.map((_, column) => cell(row[column] ?? [], column, false)).join("")}</w:tr>`)];
                    return [`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders></w:tblPr><w:tblGrid>${block.header.map(() => `<w:gridCol w:w="${each}"/>`).join("")}</w:tblGrid>${rows.join("")}</w:tbl>`, "<w:p/>"];
                }
                case "image": {
                    const drawn = picture(block.src, block.alt, block.width);
                    const shown = drawn ? paragraph(drawn, { align: block.align }) : paragraph(`<w:r><w:t xml:space="preserve">[Picture${block.alt ? `: ${xml(block.alt)}` : ""}]</w:t></w:r>`, { align: block.align });
                    return block.caption ? [shown, paragraph(`<w:r><w:t xml:space="preserve">${xml(block.caption)}</w:t></w:r>`, { style: "Caption", align: block.align })] : [shown];
                }
                case "divider":
                    return [paragraph("", { border: true })];
                case "footnote":
                    footnotes.push(...blocks(block.blocks, level, 0, "FootnoteText").map((each, index) => (index === 0 ? each.replace(/(<w:pPr>.*?<\/w:pPr>|<w:p>)/, `$1<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">${xml(block.label)} </w:t></w:r>`) : each)));
                    return [];
                case "raw":
                    if (isPageBreak(block)) return ['<w:p><w:r><w:br w:type="page"/></w:r></w:p>'];
                    if (isContentsMark(block) || /^(import|export)\b/.test(block.text)) return [];
                    return [paragraph(`<w:r><w:t xml:space="preserve">${xml(block.text)}</w:t></w:r>`, { style: "Code" })];
            }
        });

    const body = blocks(doc.blocks, 0, 0);
    if (footnotes.length) body.push(paragraph("", { border: true }), ...footnotes);
    const orient = page.orientation === "landscape" ? ' w:orient="landscape"' : "";
    const document = `${HEAD}<w:document ${NS}><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"${orient}/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

    const types = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${Object.values(SHOWN)
        .map((ending) => `<Default Extension="${ending}" ContentType="image/${ending}"/>`)
        .join("")}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
    const root = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const core = `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(options.title ?? "")}</dc:title><dc:creator>mdQuire</dc:creator></cp:coreProperties>`;
    const documentRels = `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${RELS}/numbering" Target="numbering.xml"/>${rels.join("")}</Relationships>`;
    return writeZip([
        { name: "[Content_Types].xml", data: types },
        { name: "_rels/.rels", data: root },
        { name: "docProps/core.xml", data: core },
        { name: "word/document.xml", data: document },
        { name: "word/styles.xml", data: STYLES },
        { name: "word/numbering.xml", data: numberingXml(nums) },
        { name: "word/_rels/document.xml.rels", data: documentRels },
        ...media.map((each) => ({ name: `word/media/${each.name}`, data: each.data, store: true })),
    ]);
}

/** numbering.xml: a bulleted and a numbered way of numbering, nine levels deep, and each list's own numbering of them. */
function numberingXml(nums: string[]): string {
    const bullets = ["•", "◦", "▪"];
    const level = (index: number, numbered: boolean) =>
        `<w:lvl w:ilvl="${index}"><w:start w:val="1"/><w:numFmt w:val="${numbered ? (index % 3 === 1 ? "lowerLetter" : index % 3 === 2 ? "lowerRoman" : "decimal") : "bullet"}"/><w:lvlText w:val="${numbered ? `%${index + 1}.` : bullets[index % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (index + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
    const abstract = (id: number, numbered: boolean) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, index) => level(index, numbered)).join("")}</w:abstractNum>`;
    return `${HEAD}<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstract(0, false)}${abstract(1, true)}${nums.join("")}</w:numbering>`;
}

/** styles.xml: the text's own look and the styles the document uses. */
const STYLES = `${HEAD}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" w:eastAsia="Georgia"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[36, 30, 26, 24, 22, 22]
    .map((size, index) => `<w:style w:type="paragraph" w:styleId="Heading${index + 1}"><w:name w:val="heading ${index + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${index === 0 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${index}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`)
    .join("")}<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="999999"/></w:pBdr><w:ind w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/><w:spacing w:after="160" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:color w:val="555555"/><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:contextualSpacing/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style></w:styles>`;
