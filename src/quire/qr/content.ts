// What goes into a code and what comes out of one, as phones write and read it: a link or any text; a
// Wi-Fi login (`WIFI:T:WPA;S:name;P:password;H:true;;`, with \ ; , : and " escaped by a backslash); a
// contact as a vCard 3.0 (lines ended by CR LF, with \ , ; and line breaks escaped); an email
// (`mailto:` with its subject and body percent-encoded, line breaks as CR LF); a phone call (`tel:`);
// a text message (`sms:` with its body). `describe` reads any of these back, and the older MECARD,
// MATMSG and SMSTO forms phones also make, into fields laid out by kind, for the reader. `fileName`
// gives a code's files a few safe letters saying what it holds.
//
//   const text = wifiText({ name: "Home", password: "secret", security: "WPA", hidden: false });
//   describe(text) // { kind: "wifi", title: "Wi-Fi", lines: [{ label: "Network", value: "Home" }, ...] }

/** The kinds of thing a code can hold. */
export type Kind = "text" | "wifi" | "contact" | "email" | "phone" | "message";

/** A Wi-Fi login: the network's name, its password, its kind of security, and whether it hides its name. */
export interface Wifi {
    name: string;
    password: string;
    security: "WPA" | "WEP" | "nopass";
    hidden: boolean;
}

/** A contact's fields, any of which may be empty. */
export interface Contact {
    first: string;
    last: string;
    phone: string;
    email: string;
    organization: string;
    title: string;
    website: string;
    street: string;
    city: string;
    region: string;
    postcode: string;
    country: string;
    note: string;
}

/** An email to write: to whom, its subject and its body. */
export interface Email {
    to: string;
    subject: string;
    body: string;
}

/** A text message to write: to what number, and what it says. */
export interface Message {
    number: string;
    body: string;
}

/** A contact with every field empty. */
export const EMPTY_CONTACT: Contact = { first: "", last: "", phone: "", email: "", organization: "", title: "", website: "", street: "", city: "", region: "", postcode: "", country: "", note: "" };

/** A Wi-Fi field's value escaped: a backslash before \ ; , : and ". */
export const wifiEscape = (value: string): string => value.replace(/([\\;,:"])/g, "\\$1");

/** A Wi-Fi login as phones read it from a code; a network with no password is open. */
export function wifiText(wifi: Wifi): string {
    const security = wifi.security === "nopass" || !wifi.password ? "nopass" : wifi.security;
    let text = `WIFI:T:${security};S:${wifiEscape(wifi.name)};`;
    if (security !== "nopass") text += `P:${wifiEscape(wifi.password)};`;
    if (wifi.hidden) text += "H:true;";
    return `${text};`;
}

/** A vCard value escaped: a backslash before \ , and ; and line breaks written as \n. */
export const vcardEscape = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** A contact as a vCard 3.0, only the lines it has filled in; empty when nothing is. */
export function contactText(contact: Contact): string {
    const c = Object.fromEntries(Object.entries(contact).map(([key, value]) => [key, value.trim()])) as unknown as Contact;
    const full = [c.first, c.last].filter(Boolean).join(" ");
    if (!Object.values(c).some(Boolean)) return "";
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${vcardEscape(c.last)};${vcardEscape(c.first)};;;`, `FN:${vcardEscape(full || c.organization)}`];
    if (c.organization) lines.push(`ORG:${vcardEscape(c.organization)}`);
    if (c.title) lines.push(`TITLE:${vcardEscape(c.title)}`);
    if (c.phone) lines.push(`TEL;TYPE=CELL:${vcardEscape(c.phone)}`);
    if (c.email) lines.push(`EMAIL:${vcardEscape(c.email)}`);
    if (c.website) lines.push(`URL:${vcardEscape(c.website)}`);
    if (c.street || c.city || c.region || c.postcode || c.country) lines.push(`ADR:;;${[c.street, c.city, c.region, c.postcode, c.country].map(vcardEscape).join(";")}`);
    if (c.note) lines.push(`NOTE:${vcardEscape(c.note)}`);
    lines.push("END:VCARD");
    return lines.join("\r\n");
}

/** Text percent-encoded for a mailto or sms address's query, line breaks as CR LF first. */
const queryEscape = (value: string): string => encodeURIComponent(value.replace(/\r\n|\r|\n/g, "\r\n"));

/** An email as a mailto address: the address as typed (its @ and commas kept), the subject and body percent-encoded. */
export function emailText(email: Email): string {
    const to = encodeURIComponent(email.to.trim()).replace(/%40/g, "@").replace(/%2C/gi, ",");
    const query = [email.subject ? `subject=${queryEscape(email.subject)}` : "", email.body ? `body=${queryEscape(email.body)}` : ""].filter(Boolean).join("&");
    return `mailto:${to}${query ? `?${query}` : ""}`;
}

/** A phone number as a dialer reads it: the digits, a leading plus, and * and # (written %23), the spaces and marks between digits left out. */
export function phoneNumber(number: string): string {
    const kept = number.trim().replace(/[^0-9+*#]/g, "");
    return (kept.startsWith("+") ? "+" : "") + kept.replace(/\+/g, "").replace(/#/g, "%23");
}

/** A phone call as a tel address. */
export const phoneText = (number: string): string => `tel:${phoneNumber(number)}`;

/** A text message as an sms address, its body percent-encoded. */
export function messageText(message: Message): string {
    return `sms:${phoneNumber(message.number)}${message.body ? `?body=${queryEscape(message.body)}` : ""}`;
}

/** A line of what a code holds: what it is, and its value. */
export interface Line {
    label: string;
    value: string;
}

/** What a code holds, laid out by its kind: its title, its lines, and the address if it is a link. */
export interface Described {
    kind: Kind | "link";
    title: string;
    lines: Line[];
    link?: string;
}

/** Splits text on a character that is not escaped by a backslash, taking the escapes out of each part. */
function splitEscaped(text: string, by: string): string[] {
    const parts: string[] = [];
    let now = "";
    for (let i = 0; i < text.length; i++) {
        const c = text[i]!;
        if (c === "\\" && i + 1 < text.length) now += text[++i]!;
        else if (c === by) {
            parts.push(now);
            now = "";
        } else now += c;
    }
    parts.push(now);
    return parts;
}

/** Percent-decoding that leaves text as it was where it is not valid. */
const decoded = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

/** A vCard value with its escapes taken out. */
const vcardValue = (value: string): string => value.replace(/\\(n|N|,|;|\\)/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

/** The fields of a `KEY:value;KEY:value;;` form, as MECARD, MATMSG and WIFI write them. */
function fieldsOf(body: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    // split on ; not escaped, keeping each part's escapes for its own reading
    let now = "";
    const parts: string[] = [];
    for (let i = 0; i < body.length; i++) {
        const c = body[i]!;
        if (c === "\\" && i + 1 < body.length) now += c + body[++i]!;
        else if (c === ";") {
            parts.push(now);
            now = "";
        } else now += c;
    }
    parts.push(now);
    for (const part of parts) {
        const colon = part.indexOf(":");
        if (colon <= 0) continue;
        const key = part.slice(0, colon).toUpperCase();
        const value = splitEscaped(part.slice(colon + 1), "\u0000")[0]!;
        fields.set(key, [...(fields.get(key) ?? []), value]);
    }
    return fields;
}

const SECURITY: Record<string, string> = { WPA: "WPA", WPA2: "WPA2", WPA3: "WPA3", SAE: "WPA3", WEP: "WEP", NOPASS: "None", "": "None" };

/** What a code's text holds, laid out by its kind, for the reader to show. */
export function describe(text: string): Described {
    const trimmed = text.trim();
    if (/^WIFI:/i.test(trimmed)) {
        const fields = fieldsOf(trimmed.slice(5));
        const security = (fields.get("T")?.[0] ?? "").toUpperCase();
        const lines: Line[] = [{ label: "Network", value: fields.get("S")?.[0] ?? "" }];
        if (fields.get("P")?.[0]) lines.push({ label: "Password", value: fields.get("P")![0]! });
        lines.push({ label: "Security", value: SECURITY[security] ?? security });
        if ((fields.get("H")?.[0] ?? "").toLowerCase() === "true") lines.push({ label: "Hidden", value: "Yes" });
        return { kind: "wifi", title: "Wi-Fi", lines };
    }
    if (/^BEGIN:VCARD/i.test(trimmed)) {
        const lines: Line[] = [];
        const unfolded = trimmed.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
        let name = "";
        let structured = "";
        for (const line of unfolded) {
            const colon = line.indexOf(":");
            if (colon < 0) continue;
            const key = line.slice(0, colon).split(";")[0]!.toUpperCase();
            const value = line.slice(colon + 1);
            if (key === "FN") name = vcardValue(value);
            else if (key === "N") structured = splitEscaped(value, ";").slice(0, 2).reverse().map(vcardValue).filter(Boolean).join(" ");
            else if (key === "ORG") lines.push({ label: "Organization", value: splitEscaped(value, ";").map(vcardValue).filter(Boolean).join(", ") });
            else if (key === "TITLE") lines.push({ label: "Title", value: vcardValue(value) });
            else if (key === "TEL") lines.push({ label: "Phone", value: vcardValue(value) });
            else if (key === "EMAIL") lines.push({ label: "Email", value: vcardValue(value) });
            else if (key === "URL") lines.push({ label: "Website", value: vcardValue(value) });
            else if (key === "ADR") lines.push({ label: "Address", value: splitEscaped(value, ";").map(vcardValue).filter(Boolean).join(", ") });
            else if (key === "NOTE") lines.push({ label: "Note", value: vcardValue(value) });
        }
        if (name || structured) lines.unshift({ label: "Name", value: name || structured });
        return { kind: "contact", title: "Contact", lines };
    }
    if (/^MECARD:/i.test(trimmed)) {
        const fields = fieldsOf(trimmed.slice(7));
        const lines: Line[] = [];
        const name = fields.get("N")?.[0];
        if (name) lines.push({ label: "Name", value: name.includes(",") ? name.split(",").reverse().join(" ").trim() : name });
        for (const [key, label] of [["ORG", "Organization"], ["TEL", "Phone"], ["EMAIL", "Email"], ["URL", "Website"], ["ADR", "Address"], ["NOTE", "Note"]] as const) for (const value of fields.get(key) ?? []) lines.push({ label, value });
        return { kind: "contact", title: "Contact", lines };
    }
    if (/^mailto:/i.test(trimmed)) {
        const [address = "", query = ""] = trimmed.slice(7).split("?");
        const lines: Line[] = [{ label: "To", value: decoded(address) }];
        for (const pair of query.split("&")) {
            const [key = "", value = ""] = pair.split("=");
            if (key.toLowerCase() === "subject") lines.push({ label: "Subject", value: decoded(value) });
            else if (key.toLowerCase() === "body") lines.push({ label: "Message", value: decoded(value).replace(/\r\n/g, "\n") });
            else if (key.toLowerCase() === "cc") lines.push({ label: "Copy to", value: decoded(value) });
        }
        return { kind: "email", title: "Email", lines };
    }
    if (/^MATMSG:/i.test(trimmed)) {
        const fields = fieldsOf(trimmed.slice(7));
        const lines: Line[] = [{ label: "To", value: fields.get("TO")?.[0] ?? "" }];
        if (fields.get("SUB")?.[0]) lines.push({ label: "Subject", value: fields.get("SUB")![0]! });
        if (fields.get("BODY")?.[0]) lines.push({ label: "Message", value: fields.get("BODY")![0]! });
        return { kind: "email", title: "Email", lines };
    }
    if (/^tel:/i.test(trimmed)) return { kind: "phone", title: "Phone call", lines: [{ label: "Number", value: decoded(trimmed.slice(4)) }] };
    if (/^(sms|smsto):/i.test(trimmed)) {
        const rest = trimmed.slice(trimmed.indexOf(":") + 1);
        let number = rest;
        let body = "";
        if (/^smsto:/i.test(trimmed)) {
            const colon = rest.indexOf(":");
            if (colon >= 0) [number, body] = [rest.slice(0, colon), rest.slice(colon + 1)];
        } else {
            const query = rest.search(/[?&]/);
            if (query >= 0) {
                number = rest.slice(0, query);
                const found = /(?:^|[?&])body=([^&]*)/i.exec(rest.slice(query));
                body = found ? decoded(found[1]!).replace(/\r\n/g, "\n") : "";
            }
        }
        const lines: Line[] = [{ label: "Number", value: decoded(number) }];
        if (body) lines.push({ label: "Message", value: body });
        return { kind: "message", title: "Text message", lines };
    }
    if (/^https?:\/\/\S+$/i.test(trimmed)) return { kind: "link", title: "Link", lines: [{ label: "Address", value: trimmed }], link: trimmed };
    return { kind: "text", title: "Text", lines: [{ label: "Text", value: text }] };
}

/** A few safe letters for a file holding a code: `qr`, its kind, and a word or two of what it holds, in plain ASCII letters, digits and hyphens. */
export function fileName(kind: Kind, text: string, extension: string): string {
    const said = describe(text);
    let words = "";
    if (said.kind === "link") words = said.link!.replace(/^https?:\/\/(www\.)?/i, "").split(/[/?#]/)[0]!;
    else if (kind === "wifi" || said.kind === "wifi") words = said.lines[0]?.value ?? "";
    else if (said.kind === "contact") words = said.lines.find((each) => each.label === "Name")?.value ?? said.lines[0]?.value ?? "";
    else if (said.kind === "email" || said.kind === "phone" || said.kind === "message") words = said.lines[0]?.value.split("@")[0] ?? "";
    else words = text.split(/\s+/).slice(0, 3).join(" ");
    const safe = words
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^A-Za-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32)
        .replace(/-+$/, "")
        .toLowerCase();
    const kindWord = { text: said.kind === "link" ? "link" : "text", wifi: "wifi", contact: "contact", email: "email", phone: "phone", message: "message" }[kind];
    return `qr-${kindWord}${safe ? `-${safe}` : ""}.${extension}`;
}
