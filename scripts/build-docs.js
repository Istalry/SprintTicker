const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

/**
 * Renders the three Markdown documents into `docs/index.html`, the page GitHub
 * Pages serves.
 *
 * The page and the Markdown used to be two hand-maintained copies of the same
 * text, which is the duplicated-constant hazard from CLAUDE.md §3 wearing
 * different clothes: nothing fails when they disagree, and the reader trusts
 * whichever one they happened to open. The Markdown is now the only source and
 * the page is generated, so they cannot drift.
 *
 *   node scripts/build-docs.js            # write docs/index.html
 *   node scripts/build-docs.js --check    # fail if it is out of date
 *
 * `--check` runs in CI. That is the part that makes this stick: a rule saying
 * "regenerate the page" is a rule someone forgets, whereas a failing job is not
 * forgettable.
 *
 * Deliberately not a static-site generator. One page, three inputs, and a shell
 * that is itself part of the design -- a framework would be more configuration
 * than content.
 */

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'index.html');

const DOCUMENTS = [
  { id: 'guide', file: 'USER-GUIDE.md', label: 'Document 1' },
  { id: 'architecture', file: 'ARCHITECTURE.md', label: 'Document 2' },
  { id: 'api', file: 'API.md', label: 'Document 3' }
];

/**
 * Replaces the ASCII diagram in ARCHITECTURE.md with a drawn one.
 *
 * The Markdown keeps the ASCII block because that is what renders on GitHub,
 * where there is no stylesheet to hang an SVG off. The marker below is an HTML
 * comment, so GitHub shows nothing and this build knows where to substitute.
 */
const DIAGRAM_MARKER = '<!-- docs-build:svg=architecture -->';

const ARCHITECTURE_SVG = `<div class="diagram">
<svg viewBox="0 0 660 330" role="img" aria-label="The renderer talks to main only through the preload contextBridge. Main hosts the time-tracking engine, the provider manager, the priority engine, the display renderer and the notification listener, owns the SQLite database, serves a loopback HTTP server for the Unity plugin, and drives the BUSY Bar over USB.">
  <g font-family="IBM Plex Mono, monospace" font-size="10.5">
    <rect x="150" y="8" width="360" height="42" rx="3" fill="var(--surface-2)" stroke="var(--border)"/>
    <text x="330" y="26" text-anchor="middle" fill="var(--ink)" font-size="12" font-weight="600">RENDERER</text>
    <text x="330" y="40" text-anchor="middle" fill="var(--ink-3)">React 18 &#183; 9 views &#183; no Node, no Electron</text>

    <line x1="330" y1="50" x2="330" y2="70" stroke="var(--accent-line)" stroke-width="1.5"/>
    <text x="338" y="64" fill="var(--accent)">window.electronAPI</text>

    <rect x="150" y="70" width="360" height="34" rx="3" fill="var(--surface-2)" stroke="var(--accent-line)" stroke-dasharray="3 2"/>
    <text x="330" y="91" text-anchor="middle" fill="var(--ink)" font-size="11" font-weight="600">PRELOAD &#183; contextBridge &#183; the only path</text>

    <line x1="330" y1="104" x2="330" y2="122" stroke="var(--border)" stroke-width="1.5"/>

    <rect x="16" y="122" width="628" height="132" rx="3" fill="var(--surface-2)" stroke="var(--border)"/>
    <text x="30" y="140" fill="var(--ink)" font-size="12" font-weight="600">MAIN</text>

    <rect x="30" y="150" width="600" height="26" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="330" y="167" text-anchor="middle" fill="var(--ink-2)">IpcHandlerRegistry &#8212; the single place a channel gets a handler</text>

    <rect x="30" y="184" width="112" height="34" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="86" y="199" text-anchor="middle" fill="var(--ink)">TimeTracking</text>
    <text x="86" y="211" text-anchor="middle" fill="var(--ink)">Engine</text>

    <rect x="150" y="184" width="112" height="34" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="206" y="199" text-anchor="middle" fill="var(--ink)">Provider</text>
    <text x="206" y="211" text-anchor="middle" fill="var(--ink)">Manager</text>

    <rect x="270" y="184" width="112" height="34" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="326" y="199" text-anchor="middle" fill="var(--ink)">Priority</text>
    <text x="326" y="211" text-anchor="middle" fill="var(--ink)">Preemption</text>

    <rect x="390" y="184" width="112" height="34" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="446" y="199" text-anchor="middle" fill="var(--ink)">Display</text>
    <text x="446" y="211" text-anchor="middle" fill="var(--ink)">Renderer</text>

    <rect x="510" y="184" width="120" height="34" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="570" y="199" text-anchor="middle" fill="var(--ink)">Notification</text>
    <text x="570" y="211" text-anchor="middle" fill="var(--ink)">Listener</text>

    <rect x="30" y="226" width="232" height="20" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="146" y="240" text-anchor="middle" fill="var(--ink-2)">Repositories &#8594; SQLite</text>

    <rect x="390" y="226" width="240" height="20" rx="2" fill="var(--surface)" stroke="var(--border)"/>
    <text x="510" y="240" text-anchor="middle" fill="var(--ink-2)">WebhookServer 127.0.0.1:39123</text>

    <line x1="446" y1="254" x2="446" y2="278" stroke="var(--accent-line)" stroke-width="1.5"/>
    <rect x="352" y="278" width="188" height="38" rx="3" fill="var(--panel)" stroke="var(--accent-line)"/>
    <text x="446" y="294" text-anchor="middle" fill="#E3A340" font-weight="600">BUSY Bar</text>
    <text x="446" y="308" text-anchor="middle" fill="#8791A1">10.0.4.20 over USB</text>

    <line x1="206" y1="254" x2="206" y2="278" stroke="var(--border)" stroke-width="1.5"/>
    <rect x="112" y="278" width="188" height="38" rx="3" fill="var(--surface)" stroke="var(--border)"/>
    <text x="206" y="294" text-anchor="middle" fill="var(--ink)" font-weight="600">OpenProject / Jira</text>
    <text x="206" y="308" text-anchor="middle" fill="var(--ink-3)">over the internet</text>
  </g>
</svg>
</div>`;

/** Turns heading text into a URL fragment, scoped to its document. */
function slug(docId, text) {
  const base = text
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, '')
    .toLowerCase()
    .replace(/^\d+\.\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${docId}-${base}`;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * Reads the versions the masthead advertises out of the manifest.
 *
 * Hardcoded here they would be exactly the stale-number problem CLAUDE.md §9
 * describes: nothing fails when "Electron 44" becomes false. The test count
 * that used to sit alongside them is gone rather than derived -- it changes
 * with every commit and reads as precision the page cannot keep.
 */
function readStack() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'packages', 'desktop-app', 'package.json'), 'utf8')
  );
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const major = name => {
    const range = deps[name];
    if (!range) return null;
    const m = /(\d+)/.exec(range);
    return m ? m[1] : null;
  };
  const chips = [];
  if (major('electron')) chips.push(`Electron ${major('electron')}`);
  if (major('react')) chips.push(`React ${major('react')}`);
  if (major('better-sqlite3')) chips.push(`better-sqlite3 ${major('better-sqlite3')}`);
  chips.push('Windows x64');
  chips.push('MIT');
  return chips;
}

/**
 * Splits a document into its title, its opening paragraphs and its body.
 *
 * The lead-in becomes the section header's standfirst, which is why it is
 * separated rather than rendered inline: everything before the first `##` is
 * the document introducing itself.
 */
function splitDocument(md) {
  const withoutH1 = md.replace(/^#\s+(.+)\n/, '');
  const title = (/^#\s+(.+)$/m.exec(md) || [, 'Untitled'])[1].trim();

  const firstSection = withoutH1.search(/^##\s+/m);
  let intro = firstSection === -1 ? withoutH1 : withoutH1.slice(0, firstSection);
  const body = firstSection === -1 ? '' : withoutH1.slice(firstSection);

  // The rule under the standfirst is the shell's job, not the content's.
  intro = intro.replace(/^---\s*$/gm, '').trim();

  return { title, intro, body };
}

/**
 * Post-processes marked's output into the page's own vocabulary.
 *
 * Done on the HTML string rather than through a custom `Renderer`, because
 * marked's renderer signature has changed shape across majors and this survives
 * that; the transformations below are all structural and unambiguous.
 */
function decorate(html, docId, headings) {
  let out = html;

  // Heading levels shift down one: the document's own title is already an <h2>
  // in the shell, so its `##` sections become <h3>. Deepest first, or the
  // rewritten tags get rewritten again.
  out = out.replace(/<h4>([\s\S]*?)<\/h4>/g, (_, inner) => `<h5>${inner}</h5>`);
  out = out.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, inner) => `<h4>${inner}</h4>`);
  out = out.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner) => {
    const text = stripTags(inner);
    const id = slug(docId, text);
    headings.push({ id, text: text.replace(/^\d+\.\s*/, '') });
    return `<h3 id="${id}">${inner}</h3>`;
  });

  // Tables scroll inside their own container so the page body never does.
  out = out.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');

  // A blockquote is the page's callout, and GitHub's own alert syntax decides
  // which kind: `> [!WARNING]` is a trap, anything else an aside. Declared
  // rather than inferred -- an earlier version guessed from keywords in the
  // label and quietly filed "Row 0 has no character capacity" as an aside,
  // which is exactly the sort of thing that must not read as one. The syntax is
  // also what GitHub renders natively, so the Markdown gains a real callout
  // there instead of paying a tax for this page.
  out = out.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_, inner) => {
    const alert = /\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.exec(inner);
    const kind = alert ? alert[1] : null;
    const isTrap = kind === 'WARNING' || kind === 'CAUTION' || kind === 'IMPORTANT';

    let body = inner;
    if (alert) {
      // Drop the marker, and the now-empty paragraph or stray break it leaves.
      body = body.replace(/\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?\s*/, '');
      body = body.replace(/<p>\s*<\/p>/g, '');
    }

    const leadIn = /<strong>(.*?)<\/strong>/.exec(body);
    const label = leadIn ? leadIn[1] : '';
    if (leadIn) body = body.replace(/<strong>.*?<\/strong>:?\s*/, '');

    return (
      `<div class="note${isTrap ? ' trap' : ''}">` +
      (label ? `<span class="label">${label}</span>` : '') +
      body +
      '</div>'
    );
  });

  return out;
}

function buildHtml() {
  const chips = readStack();
  const sections = [];
  const rail = [];

  for (const doc of DOCUMENTS) {
    const file = path.join(ROOT, 'Documentation', doc.file);
    if (!fs.existsSync(file)) {
      throw new Error(`Missing source document: ${path.relative(ROOT, file)}`);
    }
    // Normalised to LF before anything parses it. This repository is developed
    // on Windows and `core.autocrlf` hands these files back with CRLF, where
    // JavaScript treats `\r` as a line terminator -- so `.` in the patterns
    // below stops short of it. The symptom was not an error: the document's own
    // `# Title` simply stopped being recognised and rendered into the body as a
    // stray heading, on a CRLF checkout only.
    let md = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

    if (md.includes(DIAGRAM_MARKER)) {
      // Swap the marker and the fenced ASCII block that follows it.
      md = md.replace(
        new RegExp(DIAGRAM_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*```[\\s\\S]*?```'),
        ARCHITECTURE_SVG
      );
    }

    const { title, intro, body } = splitDocument(md);
    const headings = [];
    const bodyHtml = decorate(marked.parse(body), doc.id, headings);
    const introHtml = marked.parse(intro);

    rail.push({ id: doc.id, title, headings });
    sections.push(
      `    <section id="${doc.id}">\n` +
        `      <div class="doc-head">\n` +
        `        <div class="num">${doc.label}</div>\n` +
        `        <h2>${title}</h2>\n` +
        introHtml.replace(/^/gm, '        ').trimEnd() +
        `\n      </div>\n` +
        bodyHtml.replace(/^/gm, '      ').trimEnd() +
        `\n    </section>`
    );
  }

  const railHtml = rail
    .map(
      d =>
        `      <a class="lead" href="#${d.id}">${d.title}</a>\n` +
        d.headings.map(h => `      <a href="#${h.id}">${h.text}</a>`).join('\n')
    )
    .join('\n');

  return SHELL.replace('{{CHIPS}}', chips.map(c => `        <span class="chip">${c}</span>`).join('\n'))
    .replace('{{RAIL}}', railHtml)
    .replace('{{SECTIONS}}', sections.join('\n\n'));
}

const SHELL = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="User guide, architecture and API reference for SprintTicker, a Windows time tracker for the BUSY Bar.">
<!-- Four lit dots on a dark bar: the front matrix, at the only size a favicon
     has room for. -->
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%2314171D'/%3E%3Cg fill='%23E3A340'%3E%3Ccircle cx='4' cy='6' r='1.5'/%3E%3Ccircle cx='8' cy='6' r='1.5'/%3E%3Ccircle cx='12' cy='6' r='1.5'/%3E%3Ccircle cx='4' cy='10' r='1.5'/%3E%3C/g%3E%3C/svg%3E">
<title>SprintTicker Documentation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">

<!-- GENERATED FILE. Do not edit.
     Source: Documentation/USER-GUIDE.md, ARCHITECTURE.md, API.md
     Rebuild: pnpm docs:build       Verify: pnpm docs:check -->

<style>
  :root {
    --ground:      #EEF0F4;
    --surface:     #FFFFFF;
    --surface-2:   #F5F7FA;
    --border:      #D5DAE3;
    --border-soft: #E3E7EE;
    --ink:         #171A21;
    --ink-2:       #4A5262;
    --ink-3:       #6F7889;
    --accent:      #A66A10;
    --accent-line: #C98A22;
    --teal:        #0E6F68;
    --danger:      #A6322A;
    --danger-bg:   #FBEDEB;
    --led-on:      #C98A22;
    --panel:       #14171D;

    --f-display: "IBM Plex Sans Condensed", "Helvetica Neue", Arial, sans-serif;
    --f-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
    --f-mono: "IBM Plex Mono", ui-monospace, "Cascadia Mono", Consolas, monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground:      #0E1116;
      --surface:     #161A21;
      --surface-2:   #1B212A;
      --border:      #2A313D;
      --border-soft: #222932;
      --ink:         #E7EBF1;
      --ink-2:       #A7B1C0;
      --ink-3:       #7C8697;
      --accent:      #E3A340;
      --accent-line: #8A6524;
      --teal:        #46BFB1;
      --danger:      #E9776B;
      --danger-bg:   #2A1A18;
      --led-on:      #E3A340;
      --panel:       #090B0F;
    }
  }

  :root[data-theme="dark"] {
    --ground:      #0E1116;
    --surface:     #161A21;
    --surface-2:   #1B212A;
    --border:      #2A313D;
    --border-soft: #222932;
    --ink:         #E7EBF1;
    --ink-2:       #A7B1C0;
    --ink-3:       #7C8697;
    --accent:      #E3A340;
    --accent-line: #8A6524;
    --teal:        #46BFB1;
    --danger:      #E9776B;
    --danger-bg:   #2A1A18;
    --led-on:      #E3A340;
    --panel:       #090B0F;
  }

  * { box-sizing: border-box; }
  :root { color-scheme: light dark; }
  img { max-width: 100%; }
  [hidden] { display: none !important; }

  body {
    margin: 0;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--f-body);
    font-size: 16px;
    line-height: 1.62;
    -webkit-font-smoothing: antialiased;
  }

  ::selection { background: var(--accent); color: var(--surface); }

  a { color: var(--teal); text-underline-offset: 3px; text-decoration-thickness: 1px; }
  a:focus-visible, button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: 2px;
  }

  .masthead {
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 44px 32px 40px;
  }

  .masthead-inner {
    max-width: 1180px;
    margin: 0 auto;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 48px;
    align-items: center;
  }

  .eyebrow {
    font-family: var(--f-mono);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: #E3A340;
  }

  .masthead h1 {
    font-family: var(--f-display);
    font-weight: 700;
    font-size: clamp(38px, 6vw, 62px);
    line-height: .98;
    letter-spacing: -.015em;
    margin: 14px 0 0;
    color: #F2F4F8;
    text-wrap: balance;
  }

  .masthead p {
    margin: 16px 0 0;
    max-width: 54ch;
    color: #9AA4B4;
    font-size: 16.5px;
  }

  .masthead .meta { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 8px; }

  .chip {
    font-family: var(--f-mono);
    font-size: 11.5px;
    letter-spacing: .03em;
    color: #B9C2D0;
    border: 1px solid #2C333F;
    border-radius: 2px;
    padding: 4px 9px;
    background: #171B22;
  }

  .bar-figure { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; margin: 0; }

  .bar-shell {
    background: #05070A;
    border: 1px solid #262D38;
    border-radius: 5px;
    padding: 11px 13px;
    box-shadow: inset 0 0 26px rgba(227,163,64,.05);
  }

  #matrix { display: block; image-rendering: pixelated; }

  .bar-caption {
    font-family: var(--f-mono);
    font-size: 11px;
    color: #6E7889;
    letter-spacing: .02em;
  }

  .shell {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 32px 96px;
    display: grid;
    grid-template-columns: 216px minmax(0, 1fr);
    gap: 52px;
    align-items: start;
  }

  .rail { position: sticky; top: 28px; padding-top: 44px; }

  .rail-title {
    font-family: var(--f-mono);
    font-size: 10.5px;
    letter-spacing: .14em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin-bottom: 12px;
  }

  .rail nav { display: flex; flex-direction: column; }

  .rail a {
    font-size: 14px;
    color: var(--ink-2);
    text-decoration: none;
    padding: 6px 0 6px 13px;
    border-left: 2px solid var(--border-soft);
    transition: color .12s, border-color .12s;
  }
  .rail a:hover { color: var(--ink); border-left-color: var(--accent); }
  .rail a.lead { font-weight: 600; color: var(--ink); margin-top: 18px; }
  .rail a.lead:first-child { margin-top: 0; }

  main { padding-top: 44px; min-width: 0; }

  section { scroll-margin-top: 24px; }
  section + section { margin-top: 76px; }

  .doc-head { border-top: 2px solid var(--ink); padding-top: 16px; margin-bottom: 30px; }

  .doc-head .num {
    font-family: var(--f-mono);
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--accent);
  }

  h2 {
    font-family: var(--f-display);
    font-weight: 700;
    font-size: 34px;
    line-height: 1.1;
    letter-spacing: -.01em;
    margin: 6px 0 0;
    text-wrap: balance;
  }

  .doc-head p { margin: 10px 0 0; color: var(--ink-2); max-width: 66ch; }
  .doc-head ul { color: var(--ink-2); }

  h3 {
    font-family: var(--f-display);
    font-weight: 600;
    font-size: 21px;
    line-height: 1.25;
    margin: 42px 0 0;
    scroll-margin-top: 20px;
    text-wrap: balance;
  }

  h4 {
    font-family: var(--f-body);
    font-weight: 600;
    font-size: 15.5px;
    margin: 30px 0 0;
    color: var(--ink);
  }

  h5 {
    font-family: var(--f-mono);
    font-weight: 500;
    font-size: 12px;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--ink-3);
    margin: 24px 0 0;
  }

  p, ul, ol { max-width: 68ch; }
  p { margin: 14px 0 0; }
  ul, ol { margin: 14px 0 0; padding-left: 20px; }
  li { margin-top: 7px; }
  li::marker { color: var(--ink-3); }

  ol { counter-reset: step; list-style: none; padding-left: 0; }
  ol > li {
    counter-increment: step;
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr);
    gap: 14px;
    padding: 13px 0;
    margin: 0;
    border-bottom: 1px solid var(--border-soft);
  }
  ol > li:last-child { border-bottom: 0; }
  ol > li::before {
    content: counter(step, decimal-leading-zero);
    font-family: var(--f-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--accent);
  }
  ol ul { grid-column: 2; }

  hr { border: 0; border-top: 1px solid var(--border-soft); margin: 40px 0 0; max-width: 68ch; }

  code {
    font-family: var(--f-mono);
    font-size: .875em;
    background: var(--surface-2);
    border: 1px solid var(--border-soft);
    border-radius: 3px;
    padding: 1px 5px;
    overflow-wrap: anywhere;
  }

  pre {
    margin: 20px 0 0;
    padding: 16px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    overflow-x: auto;
    max-width: 100%;
  }
  pre code {
    background: transparent;
    border: 0;
    padding: 0;
    font-size: 13px;
    line-height: 1.6;
    overflow-wrap: normal;
  }

  strong { font-weight: 600; }

  .table-wrap {
    overflow-x: auto;
    margin-top: 20px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
  }

  table { border-collapse: collapse; width: 100%; font-size: 14.5px; }

  th {
    font-family: var(--f-mono);
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-align: left;
    padding: 11px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-2);
    white-space: nowrap;
  }

  td {
    padding: 11px 16px;
    border-bottom: 1px solid var(--border-soft);
    vertical-align: top;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  tr:last-child td { border-bottom: 0; }
  td:first-child { color: var(--ink); }
  td code { background: transparent; border: 0; padding: 0; color: var(--ink); }
  th[align="right"], td[align="right"] { text-align: right; }

  .note {
    margin-top: 22px;
    padding: 14px 18px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--teal);
    border-radius: 0 3px 3px 0;
    font-size: 14.5px;
    color: var(--ink-2);
    max-width: 68ch;
  }
  .note p { margin: 0; max-width: none; }
  .note p + p { margin-top: 9px; }
  .note.trap { border-left-color: var(--danger); background: var(--danger-bg); }
  .note .label {
    font-family: var(--f-mono);
    font-size: 10.5px;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--teal);
    display: block;
    margin-bottom: 5px;
  }
  .note.trap .label { color: var(--danger); }

  .diagram {
    margin-top: 24px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    padding: 22px;
    overflow-x: auto;
  }
  .diagram svg { display: block; min-width: 620px; }

  footer {
    max-width: 1180px;
    margin: 0 auto;
    padding: 26px 32px 60px;
    border-top: 1px solid var(--border);
    color: var(--ink-3);
    font-size: 13.5px;
  }
  footer p { max-width: 74ch; }
  footer p + p { margin-top: 10px; }

  @media (max-width: 900px) {
    .masthead { padding: 32px 22px; }
    .masthead-inner { grid-template-columns: minmax(0, 1fr); gap: 30px; }
    .shell { grid-template-columns: minmax(0, 1fr); gap: 0; padding: 0 22px 70px; }
    .rail { position: static; padding-top: 34px; }
    .rail nav { flex-flow: row wrap; gap: 3px 0; }
    .rail a { padding: 5px 11px; border-left: 0; border-bottom: 2px solid var(--border-soft); }
    .rail a.lead { margin-top: 0; }
    footer { padding: 26px 22px 50px; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: .001ms !important; transition-duration: .001ms !important; }
  }
</style>
</head>
<body>

<header class="masthead">
  <div class="masthead-inner">
    <div>
      <div class="eyebrow">Documentation</div>
      <h1>SprintTicker</h1>
      <p>
        A Windows time tracker that puts what you are working on onto a BUSY Bar &mdash; a USB device
        with a 72&times;16 RGB LED matrix on the front.
      </p>
      <div class="meta">
{{CHIPS}}
      </div>
    </div>
    <figure class="bar-figure">
      <div class="bar-shell"><canvas id="matrix" width="592" height="136"></canvas></div>
      <figcaption class="bar-caption">Front matrix &mdash; 72&times;16 px, icon at x=0&hellip;15, text at x=17 in a 55 px field</figcaption>
    </figure>
  </div>
</header>

<div class="shell">
  <aside class="rail">
    <div class="rail-title">Contents</div>
    <nav>
{{RAIL}}
    </nav>
  </aside>

  <main>

{{SECTIONS}}

  </main>
</div>

<footer>
  <p>
    SprintTicker is MIT-licensed and not affiliated with, endorsed by, or supported by Flipper FZCO.
    &ldquo;BUSY Bar&rdquo; is their product; this is a third-party companion app for it. Two files
    carry their own terms: the <code>Animations/</code> frame sets are CC-BY-SA-4.0, and the
    generated glyph table in <code>shared/busy-font.ts</code> is OFL-1.1.
  </p>
  <p>
    Generated from <code>Documentation/USER-GUIDE.md</code>, <code>ARCHITECTURE.md</code> and
    <code>API.md</code> by <code>pnpm docs:build</code>. Where this page and the code disagree, the
    code is right.
  </p>
</footer>

<script>
(function () {
  var canvas = document.getElementById('matrix');
  if (!canvas || !canvas.getContext) return;

  var COLS = 72, ROWS = 16, CELL = 8, DOT = 6;
  var ctx = canvas.getContext('2d');

  // Composed at true device resolution first, exactly as the app does it:
  // a 16px icon, a one-pixel gutter, then two text rows at x=17 in a 55px field.
  var off = document.createElement('canvas');
  off.width = COLS; off.height = ROWS;
  var o = off.getContext('2d');
  var frame;

  function compose() {
    o.clearRect(0, 0, COLS, ROWS);
    o.fillStyle = '#fff';
    o.strokeStyle = '#fff';
    o.textBaseline = 'alphabetic';
    o.beginPath(); o.arc(8, 9, 5.2, 0, Math.PI * 2); o.lineWidth = 1.4; o.stroke();
    o.fillRect(7, 2, 2, 2);
    o.fillRect(8, 6, 1, 4);
    o.font = '7px "IBM Plex Mono", monospace';
    o.fillText('SPRINTTICKER', 17, 7);
    o.font = '6px "IBM Plex Mono", monospace';
    o.fillText('01:24 TRACKING', 17, 15);
    frame = o.getImageData(0, 0, COLS, ROWS).data;
  }

  function paint(pulse) {
    var on = getComputedStyle(document.documentElement).getPropertyValue('--led-on').trim() || '#E3A340';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var y = 0; y < ROWS; y++) {
      for (var x = 0; x < COLS; x++) {
        var lit = frame[(y * COLS + x) * 4 + 3] > 110;
        ctx.fillStyle = lit ? on : '#1B212B';
        ctx.globalAlpha = lit ? 1 : 0.55;
        ctx.beginPath();
        ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, DOT / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The status dot: the one thing on a real bar that moves.
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#4FB477';
    ctx.beginPath();
    ctx.arc(68 * CELL + CELL / 2, 2 * CELL + CELL / 2, DOT / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() {
    compose();
    paint(1);
    if (reduced) return;
    var t0 = null;
    function tick(ts) {
      if (t0 === null) t0 = ts;
      var phase = ((ts - t0) % 2600) / 2600;
      paint(0.35 + 0.65 * (0.5 + 0.5 * Math.cos(phase * Math.PI * 2)));
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Wait for the webfont, so the matrix samples real glyphs and not a fallback.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(start)['catch'](start);
  } else {
    start();
  }
})();
</script>
</body>
</html>
`;

function main() {
  const check = process.argv.includes('--check');
  const html = buildHtml();

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== html) {
      console.error('[build-docs] docs/index.html is out of date.');
      console.error('[build-docs] A Markdown document under Documentation/ changed without the');
      console.error('[build-docs] page being rebuilt. Run `pnpm docs:build` and commit the result.');
      process.exit(1);
    }
    console.log('[build-docs] docs/index.html is up to date.');
    return;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(`[build-docs] Wrote ${path.relative(ROOT, OUT)} (${html.length} bytes) from ${DOCUMENTS.length} documents.`);
}

main();
