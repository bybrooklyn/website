// Styles for what written content can contain. A page that shows content imports this, so that they
// are loaded by the page and not only by the components themselves: Astro's content security policy
// does not see styles that arrive from inside rendered Markdown, and would block them.
import "./timeline.css";
import "./diagram.css";
import "./type.css";
import "./minis.css";
import "./terminal.css";
