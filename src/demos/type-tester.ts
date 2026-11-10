// <type-tester>: type your own words and try a typeface on them.
//
// Attributes: `family` (the CSS font-family to show) and `sample` (the text to
// start with). Sliders set size and weight; switches turn on italics and the
// font's alternate letters.

class TypeTester extends HTMLElement {
    connectedCallback(): void {
        const family = this.getAttribute("family") ?? "serif";
        const sample = this.getAttribute("sample") ?? "Type something here";

        this.innerHTML = `
            <div class="tester-controls">
                <label>size <input type="range" name="size" min="20" max="160" value="72"><output></output></label>
                <label>weight <input type="range" name="weight" min="100" max="900" value="400"><output></output></label>
                <label class="tester-switch"><input type="checkbox" name="italic"> italic</label>
                <label class="tester-switch"><input type="checkbox" name="ss01"> wonky h m n s</label>
                <label class="tester-switch"><input type="checkbox" name="ss02"> swash &amp;</label>
            </div>
            <div class="tester-text" contenteditable="true" spellcheck="false" role="textbox" aria-multiline="true" aria-label="Sample text, set in the typeface. Type to change it."></div>
        `;

        const text = this.querySelector<HTMLElement>(".tester-text")!;
        text.textContent = sample;
        text.style.fontFamily = `"${family}", serif`;

        const control = (name: string) => this.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
        const show = () => {
            const size = control("size").value;
            const weight = control("weight").value;
            const features = [control("ss01").checked && '"ss01"', control("ss02").checked && '"ss02"'].filter(Boolean);
            text.style.fontSize = `${size}px`;
            text.style.fontWeight = weight;
            text.style.fontStyle = control("italic").checked ? "italic" : "normal";
            text.style.fontFeatureSettings = features.length > 0 ? features.join(", ") : "normal";
            control("size").nextElementSibling!.textContent = `${size}px`;
            control("weight").nextElementSibling!.textContent = weight;
        };
        this.addEventListener("input", (event) => {
            if (event.target instanceof HTMLInputElement) show();
        });
        // Pasting keeps the words and drops whatever formatting came with them.
        text.addEventListener("paste", (event) => {
            event.preventDefault();
            const pasted = event.clipboardData?.getData("text/plain") ?? "";
            const selection = getSelection();
            if (!selection || selection.rangeCount === 0) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(document.createTextNode(pasted));
            selection.collapseToEnd();
        });
        show();
    }
}

customElements.define("type-tester", TypeTester);
