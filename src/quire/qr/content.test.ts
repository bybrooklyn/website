// What goes into a code is held to the forms phones read: Wi-Fi's escapes, vCard 3.0's lines and
// escapes, mailto's and sms's percent-encoding, tel's digits; each read back by `describe` into the same
// fields, the older MECARD, MATMSG and SMSTO forms too; and files named in a few safe letters.

import { expect, test } from "bun:test";
import { contactText, describe, emailText, EMPTY_CONTACT, fileName, messageText, phoneText, wifiText } from "./content";

test("a Wi-Fi login is written as phones read it, its special characters escaped, and read back", () => {
    expect(wifiText({ name: "Home", password: "secret", security: "WPA", hidden: false })).toBe("WIFI:T:WPA;S:Home;P:secret;;");
    const tricky = wifiText({ name: 'Café "5G"; guest', password: "a\\b;c,d:e", security: "WPA", hidden: true });
    expect(tricky).toBe('WIFI:T:WPA;S:Café \\"5G\\"\\; guest;P:a\\\\b\\;c\\,d\\:e;H:true;;');
    expect(describe(tricky).lines).toEqual([
        { label: "Network", value: 'Café "5G"; guest' },
        { label: "Password", value: "a\\b;c,d:e" },
        { label: "Security", value: "WPA" },
        { label: "Hidden", value: "Yes" },
    ]);
    // no password is an open network
    expect(wifiText({ name: "Open", password: "", security: "WPA", hidden: false })).toBe("WIFI:T:nopass;S:Open;;");
    expect(describe("WIFI:T:nopass;S:Open;;").lines).toEqual([{ label: "Network", value: "Open" }, { label: "Security", value: "None" }]);
});

test("a contact is a vCard 3.0 with only what is filled in, escaped, and read back into its lines", () => {
    const text = contactText({ ...EMPTY_CONTACT, first: "Ada", last: "Lovelace", phone: "+44 20 7946 0000", email: "ada@example.com", organization: "Analytical, Engines; Ltd", street: "12 St James's Square", city: "London", country: "UK", note: "Two lines\nof note" });
    expect(text.split("\r\n")).toEqual([
        "BEGIN:VCARD",
        "VERSION:3.0",
        "N:Lovelace;Ada;;;",
        "FN:Ada Lovelace",
        "ORG:Analytical\\, Engines\\; Ltd",
        "TEL;TYPE=CELL:+44 20 7946 0000",
        "EMAIL:ada@example.com",
        "ADR:;;12 St James's Square;London;;;UK",
        "NOTE:Two lines\\nof note",
        "END:VCARD",
    ]);
    expect(describe(text).lines).toEqual([
        { label: "Name", value: "Ada Lovelace" },
        { label: "Organization", value: "Analytical, Engines; Ltd" },
        { label: "Phone", value: "+44 20 7946 0000" },
        { label: "Email", value: "ada@example.com" },
        { label: "Address", value: "12 St James's Square, London, UK" },
        { label: "Note", value: "Two lines\nof note" },
    ]);
    expect(contactText(EMPTY_CONTACT)).toBe("");
});

test("an email, a call and a text message are addresses with their parts percent-encoded, and read back", () => {
    const email = emailText({ to: "hi@example.com", subject: "Hello & welcome", body: "Line one\nLine two" });
    expect(email).toBe("mailto:hi@example.com?subject=Hello%20%26%20welcome&body=Line%20one%0D%0ALine%20two");
    expect(describe(email).lines).toEqual([{ label: "To", value: "hi@example.com" }, { label: "Subject", value: "Hello & welcome" }, { label: "Message", value: "Line one\nLine two" }]);
    expect(emailText({ to: "a@b.c, d@e.f", subject: "", body: "" })).toBe("mailto:a@b.c,d@e.f".replace(",", ",%20"));
    expect(phoneText("+1 (555) 123-4567")).toBe("tel:+15551234567");
    expect(phoneText("*31#")).toBe("tel:*31%23");
    expect(describe("tel:+15551234567")).toEqual({ kind: "phone", title: "Phone call", lines: [{ label: "Number", value: "+15551234567" }] });
    const sms = messageText({ number: "+1 555 123 4567", body: "On my way?" });
    expect(sms).toBe("sms:+15551234567?body=On%20my%20way%3F");
    expect(describe(sms).lines).toEqual([{ label: "Number", value: "+15551234567" }, { label: "Message", value: "On my way?" }]);
});

test("the older forms phones make are read too: MECARD, MATMSG, SMSTO", () => {
    expect(describe("MECARD:N:Doe,Jane;TEL:5551234;EMAIL:jane@example.com;;").lines).toEqual([{ label: "Name", value: "Jane Doe" }, { label: "Phone", value: "5551234" }, { label: "Email", value: "jane@example.com" }]);
    expect(describe("MATMSG:TO:a@b.c;SUB:Hi;BODY:There;;").lines).toEqual([{ label: "To", value: "a@b.c" }, { label: "Subject", value: "Hi" }, { label: "Message", value: "There" }]);
    expect(describe("SMSTO:5551234:See you").lines).toEqual([{ label: "Number", value: "5551234" }, { label: "Message", value: "See you" }]);
});

test("a link is told from text, and text is given as it is", () => {
    expect(describe("https://example.com/a?b=c")).toEqual({ kind: "link", title: "Link", lines: [{ label: "Address", value: "https://example.com/a?b=c" }], link: "https://example.com/a?b=c" });
    expect(describe("javascript:alert(1)").kind).toBe("text");
    expect(describe("see https://example.com").kind).toBe("text");
    expect(describe("  two\nlines ").lines[0]!.value).toBe("  two\nlines ");
});

test("a code's files are named in a few safe letters saying what it holds", () => {
    expect(fileName("text", "https://www.example.com/path?q=1", "svg")).toBe("qr-link-example-com.svg");
    expect(fileName("wifi", wifiText({ name: "Café Wi-Fi", password: "x", security: "WPA", hidden: false }), "png")).toBe("qr-wifi-cafe-wi-fi.png");
    expect(fileName("contact", contactText({ ...EMPTY_CONTACT, first: "Zoë", last: "O'Neil" }), "png")).toBe("qr-contact-zoe-o-neil.png");
    expect(fileName("email", "mailto:hello@example.com", "svg")).toBe("qr-email-hello.svg");
    expect(fileName("text", "日本語", "svg")).toBe("qr-text.svg");
    expect(fileName("text", "Hello there, how are you today", "png")).toBe("qr-text-hello-there-how.png");
});
