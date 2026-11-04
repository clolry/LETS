/**
 * Markup integrity guards for the client templates.
 *
 * WHY THIS EXISTS
 * ---------------
 * @clolry reported raw CSS printing at the top of the New Request and Admin
 * screens. The cause was that commit 9b41317 appended new rules AFTER the
 * closing style tag of two stylesheet partials:
 *
 *   travelRequestStyles.html   53 orphaned lines  (.event-picker, .event-other)
 *   travelAdminStyles.html    169 orphaned lines  (.ev-*, the modal shell)
 *
 * Both partials are included inside <head>. Character data in the head forces
 * the parser to close the head and open the body, so the orphaned CSS became
 * the first text node of <body> — which is the "code at the top of the screen"
 * that was reported.
 *
 * THREE CONSEQUENCES, none of which any existing suite caught:
 *
 *   1. The CSS printed as prose.
 *   2. travelAdminStyles' modal-shell comment contained a literal style
 *      start-tag in its prose. Harmless inside a style element; out in the
 *      body it OPENED a raw-text element that swallowed the remainder of the
 *      file plus the whole of travelUsersStyles. CSS error recovery then ate
 *      the .oc-modal base rule, so the event/set-aside/merge dialogs lost
 *      position:fixed and rendered as unstyled blocks in the page flow.
 *   3. On My Review Queue the same swallow consumed the <script> blocks of
 *      escapeHtml, serverCall and hcDataCenterService. They never executed,
 *      so travelDelegationPanel's load() threw ReferenceError on
 *      serverCall('getMyDelegations') and THE AMBER ACT-AS BANNER NEVER
 *      PAINTED. The delegation guard in verify.yml asserts that banner cannot
 *      be dismissed; it was defeated by a parse error instead, which the
 *      guard had no way to see.
 *
 * WHY A WHOLE SUITE RATHER THAN A GREP
 * ------------------------------------
 * The existing 60-odd CI guards are behavioural: they read source files and
 * assert about their contents. Not one of them composes a page and parses it,
 * so a defect that only exists AFTER the includes are resolved is invisible to
 * all of them. §3 resolves the include graph the way the Apps Script
 * HtmlService templater does and parses the result.
 *
 * Run: node lets_app/test_markup_integrity.js
 */

const fs = require('fs');
const path = require('path');

let fails = 0;
const ok = (n, c, x) => {
  if (c) console.log('  PASS', n);
  else { console.log('  FAIL', n, x === undefined ? '' : String(x).slice(0, 400)); fails++; }
};

const CLIENT = 'lets_app/client';
const PAGES = path.join(CLIENT, 'pages');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/**
 * Tokenises HTML honouring RAW TEXT elements.
 *
 * <style> and <script> are raw-text: once open, nothing inside them is markup
 * until the matching end tag. A naive tag regex does not model that and would
 * report the CSS selectors inside a stylesheet as tags. Modelling it is the
 * whole point here, because the swallow in consequence 2 above IS raw-text
 * behaviour.
 */
function tokenize(src) {
  const toks = [];
  let i = 0, raw = null;
  const lineAt = (p) => src.slice(0, p).split('\n').length;

  while (i < src.length) {
    if (raw) {
      const close = src.toLowerCase().indexOf('</' + raw, i);
      if (close < 0) {
        toks.push({ type: 'unclosed-raw', tag: raw, line: lineAt(i) });
        break;
      }
      const gt = src.indexOf('>', close);
      toks.push({ type: 'end', tag: raw, line: lineAt(close) });
      i = gt < 0 ? src.length : gt + 1;
      raw = null;
      continue;
    }

    if (src.startsWith('<!--', i)) {
      const e = src.indexOf('-->', i);
      i = e < 0 ? src.length : e + 3;
      continue;
    }

    if (src[i] === '<') {
      const m = /^<(\/?)([a-zA-Z][^\s>/]*)/.exec(src.slice(i, i + 64));
      const gt = src.indexOf('>', i);
      const end = gt < 0 ? src.length : gt + 1;
      if (m) {
        const tag = m[2].toLowerCase();
        const closing = m[1] === '/';
        const selfClosed = src[end - 2] === '/';
        toks.push({ type: closing ? 'end' : 'start', tag, line: lineAt(i) });
        if (!closing && !selfClosed && (tag === 'style' || tag === 'script')) {
          raw = tag;
          i = end;
          continue;
        }
      }
      i = end;
      continue;
    }

    let j = src.indexOf('<', i);
    if (j < 0) j = src.length;
    const text = src.slice(i, j);
    if (text.trim()) toks.push({ type: 'text', text: text.trim(), line: lineAt(i) });
    i = j;
  }
  return toks;
}

console.log('1. every style/script element in a partial is closed in that same partial');
{
  // A partial is included verbatim into a page, so an element left open here
  // swallows whatever the page happens to put next — a different victim per
  // page, which is why this is checked at the partial and not only at the page.
  const partials = walk(path.join(CLIENT, 'styles'))
    .concat(walk(path.join(CLIENT, 'shared')))
    .concat(walk(path.join(CLIENT, 'components')))
    .concat(walk(path.join(CLIENT, 'controllers')));

  partials.forEach((f) => {
    const toks = tokenize(fs.readFileSync(f, 'utf8'));
    const stack = [];
    const problems = [];
    toks.forEach((t) => {
      if (t.type === 'unclosed-raw') problems.push(`unclosed <${t.tag}> opened near line ${t.line}`);
      if (t.tag !== 'style' && t.tag !== 'script') return;
      if (t.type === 'start') stack.push(t);
      else if (t.type === 'end') {
        if (stack.length && stack[stack.length - 1].tag === t.tag) stack.pop();
        else problems.push(`stray </${t.tag}> at line ${t.line}`);
      }
    });
    stack.forEach((t) => problems.push(`<${t.tag}> opened at line ${t.line} is never closed`));
    ok('balanced in ' + f.split('/').pop(), problems.length === 0, problems.join(' | '));
  });
}

console.log('2. no CSS rule sits outside a style element in a stylesheet partial');
{
  // The direct regression test for @clolry's report. A stylesheet partial is
  // ONLY a style element — any declaration block outside one is CSS that will
  // print to the screen as text.
  walk(path.join(CLIENT, 'styles')).forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    const toks = tokenize(src);
    // Any text token at all is suspect in a stylesheet partial: outside a
    // style element there is nothing legitimate for it to be.
    const leaked = toks.filter((t) => t.type === 'text');
    ok('no CSS outside <style> in ' + f.split('/').pop(),
       leaked.length === 0,
       leaked.map((t) => `line ${t.line}: ${t.text.slice(0, 60)}`).join(' | '));
  });
}

console.log('3. no composed page emits character data inside <head>');
{
  // Resolves the include graph the way HtmlService's templater does, then
  // parses. This is the only check in the repo that sees a page as the browser
  // will see it.
  //
  // <title> is the one element in the head whose text IS legitimate, so its
  // contents are excluded rather than the whole head being skipped.
  const resolve = (p, seen) => {
    if (seen.has(p)) return '';
    const next = new Set(seen);
    next.add(p);
    return fs.readFileSync(p, 'utf8')
      .replace(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*\?>/g, (m, inc) => {
        const f = 'lets_app/' + inc + '.html';
        if (!fs.existsSync(f)) return '';
        return resolve(f, next);
      })
      // Scriptlet output becomes text at render time; collapse it to a
      // placeholder so an interpolated value is not mistaken for a leak.
      .replace(/<\?[=!]*([\s\S]*?)\?>/g, 'x');
  };

  fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).forEach((name) => {
    const composed = resolve(path.join(PAGES, name), new Set());
    const toks = tokenize(composed);

    let inHead = false, inTitle = false;
    const leaks = [];
    for (const t of toks) {
      if (t.tag === 'head') inHead = (t.type === 'start');
      else if (t.tag === 'title') inTitle = (t.type === 'start');
      else if (t.tag === 'body' && t.type === 'start') inHead = false;
      if (t.type === 'text' && inHead && !inTitle) leaks.push(t);
    }
    ok('no character data in <head> of ' + name,
       leaks.length === 0,
       leaks.slice(0, 6).map((t) => `line ${t.line}: ${t.text.slice(0, 60)}`).join(' | '));
  });
}

console.log('4. a partial rendering markup is never included in <head>');
{
  // travelDelegationPanel renders two <div>s and was included in the head of
  // travelReviewerDashboardPage. The parser closes the head on the first one,
  // so the rest of the panel landed in the body as stray text and the act-as
  // banner never painted. Checked structurally so the next markup-bearing
  // partial cannot be placed there either.
  const rendersMarkup = (f) => {
    const toks = tokenize(fs.readFileSync(f, 'utf8'));
    return toks.some((t) => t.type === 'start' &&
      ['div', 'span', 'section', 'aside', 'header', 'main', 'nav', 'button', 'table', 'form', 'p'].includes(t.tag));
  };

  const offenders = [];
  fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).forEach((name) => {
    const src = fs.readFileSync(path.join(PAGES, name), 'utf8');
    const headEnd = src.indexOf('</head>');
    if (headEnd < 0) return;
    const head = src.slice(0, headEnd);
    for (const m of head.matchAll(/<\?!=\s*include\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const f = 'lets_app/' + m[1] + '.html';
      if (fs.existsSync(f) && rendersMarkup(f)) {
        offenders.push(`${name} includes ${m[1]} in <head>, but it renders markup`);
      }
    }
  });
  ok('no markup-bearing include in any <head>', offenders.length === 0, offenders.join(' | '));
}

console.log('5. the delegation panel loads after its serverCall dependency');
{
  // load() runs on DOMContentLoaded and calls serverCall('getMyDelegations').
  // Include order is load order here, so a panel placed before serverCall
  // throws ReferenceError and the banner silently never appears — the same
  // visible symptom as the parse bug above, from a different cause.
  fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).forEach((name) => {
    const src = fs.readFileSync(path.join(PAGES, name), 'utf8');
    const panel = src.indexOf("include('client/shared/travelDelegationPanel')");
    if (panel < 0) return;
    const sc = src.indexOf("include('client/shared/serverCall')");
    ok('serverCall precedes the delegation panel in ' + name,
       sc > -1 && sc < panel,
       sc < 0 ? 'serverCall is not included at all' : 'panel is included first');
  });
}

console.log('6. a hidden-attribute element is not overridden by a display rule');
{
  // An element rendered with `hidden` and shown by setting .hidden = false
  // must not also carry a class whose rule sets `display` to something other
  // than none: a class selector outranks the user agent's ordinary
  // [hidden] { display: none }, so the element paints while still "hidden".
  //
  // The act-as banner and the delegation modal both did this. They happened to
  // behave only because Bootstrap's reboot carries
  // [hidden] { display: none !important } and Bootstrap comes from a CDN —
  // so a failed CDN request would have shown a permanently-open delegation
  // modal, and an amber "acting on behalf of" banner, on every page that
  // includes the panel. Correctness must not depend on a third-party
  // stylesheet arriving.
  const files = walk(CLIENT);

  // Rules that set display on a BARE single-class selector, which is what can
  // outrank the UA rule. `.x[hidden]` and compound selectors are the fix, not
  // the defect, so only the bare form is collected.
  const displayFor = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const d = /(?:^|[;\s])display\s*:\s*([a-z-]+)/.exec(m[2]);
      if (!d || d[1] === 'none') continue;
      for (const one of m[1].split(',')) {
        const t = one.trim().split('\n').pop().trim();
        if (/^\.[A-Za-z0-9_-]+$/.test(t)) {
          const k = t.slice(1);
          if (!displayFor.has(k)) displayFor.set(k, []);
          displayFor.get(k).push({ f, line: src.slice(0, m.index).split('\n').length, value: d[1] });
        }
      }
    }
  }

  // Selectors that correctly re-assert the hidden state, e.g. `.actas-bar[hidden]`.
  const guarded = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\.([A-Za-z0-9_-]+)\[hidden\]/g)) guarded.add(m[1]);
  }

  const offenders = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/<(\w+)((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/g)) {
      // `hidden` as a boolean attribute, not the substring of a quoted value
      // such as aria-hidden="true" or a class name containing "hidden".
      const stripped = m[2].replace(/=\s*"[^"]*"/g, '=Q').replace(/=\s*'[^']*'/g, '=Q');
      if (!/(^|\s)hidden(\s|$|=)/.test(stripped)) continue;
      const cls = /class\s*=\s*["']([^"']+)["']/.exec(m[2]);
      if (!cls) continue;
      for (const c of cls[1].split(/\s+/)) {
        if (c.includes('$') || guarded.has(c)) continue; // template literal, or fixed
        const rules = displayFor.get(c);
        if (!rules) continue;
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(
          `${f}:${line} <${m[1]} hidden> has .${c}, which is set to ` +
          `display:${rules[0].value} at ${rules[0].f}:${rules[0].line} — add .${c}[hidden]{display:none}`
        );
      }
    }
  }
  ok('no hidden element is unhidden by a class display rule', offenders.length === 0, offenders.join(' | '));
}

console.log('7. no revealed/expanded state caps its height with a pixel ceiling');
{
  // @clolry's third report: zooming made panels crop their contents. The
  // pattern behind it was a collapse-by-max-height animation whose OPEN state
  // kept a guessed pixel ceiling over the closed state's overflow:hidden —
  // so content taller than the guess was cropped with nothing on screen to
  // say so. A per-diem figure or a clearance field silently disappearing from
  // under an approver is the failure being prevented.
  //
  // Checked by SELECTOR rather than by scanning for the pattern, because a
  // pixel ceiling over overflow:hidden is perfectly correct for a progress
  // bar or an avatar — .bar-chart__track and .pipeline__bar both do it on
  // purpose. These are the boxes that hold variable-length CONTENT.
  const mustNotCap = [
    ['travelRequestStyles.html', '.tc__stage--employee', 'traveller card stage 1'],
    ['travelRequestStyles.html', '.tc__stage--revealed', 'traveller card revealed stage'],
    ['travelRequestStyles.html', '.tc__stage--details', 'traveller details (role, duty, BU)'],
    ['travelRequestStyles.html', '.tc__stage--transport', 'transport mode + mileage'],
    ['travelRequestStyles.html', '.tc__stage--costs', 'per diem and grand total'],
    ['travelRequestStyles.html', '.tc__reveal--visible', 'revealed card fields'],
    ['travelRequestStyles.html', '.tc__details-right.tc__reveal', 'funding + role justification'],
    ['travelReviewStyles.html', '.review-traveler-row__body', 'expanded traveller detail'],
    ['travelAdminStyles.html', '.action-detail', 'reviews / stalled-requests lists'],
  ];

  mustNotCap.forEach(([file, selector, what]) => {
    const p = path.join(CLIENT, 'styles', file);
    const src = fs.readFileSync(p, 'utf8');
    const bad = [];
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selText = m[1];
      if (!selText.includes(selector)) continue;
      // Only the OPEN states matter. A closed state is identified by
      // max-height:0, which is the mechanism, not the defect.
      const body = m[2];
      if (/max-height\s*:\s*0\b/.test(body)) continue;
      const cap = /max-height\s*:\s*([0-9.]+)px/.exec(body);
      if (cap && parseFloat(cap[1]) > 0) {
        bad.push(`line ${src.slice(0, m.index).split('\n').length}: max-height:${cap[1]}px`);
      }
    }
    ok(`${selector} (${what}) has no px height ceiling`, bad.length === 0, bad.join(' | '));
  });
}

console.log('8. a page on a clipped body owns a scroll container');
{
  // @clolry's second report: the FY27 Travel Financial Governance page could
  // not be scrolled, so the DAC table, Configured DAC Approvers and
  // Historical Event Attendance were all unreachable.
  //
  // travelPortalStyles clips at three levels — html, body and
  // .travel-portal-body all carry overflow:hidden. That is correct for the
  // PORTAL, which nests its content in .portal-content (overflow-y:auto). The
  // budget page borrowed the body class and never built the equivalent, so
  // its <main> hung straight off a clipped body with nowhere for the overflow
  // to go and no scrollbar.
  //
  // Any page adopting that body class must name its own scroller.
  const portalStyles = fs.readFileSync(path.join(CLIENT, 'styles', 'travelPortalStyles.html'), 'utf8');
  ok('travel-portal-body still clips (this guard is only needed while it does)',
     /\.travel-portal-body\s*\{[^}]*overflow\s*:\s*hidden/.test(portalStyles));

  fs.readdirSync(PAGES).filter((f) => f.endsWith('.html')).forEach((name) => {
    const raw = fs.readFileSync(path.join(PAGES, name), 'utf8');
    if (!/<body[^>]*class\s*=\s*["'][^"']*travel-portal-body/.test(raw)) return;

    // Blank out comments before looking for the real <main>. Both HTML
    // comments and CSS comments, because a CSS comment inside <style> can
    // mention a tag too — this guard's first version matched a "<main>" in
    // the budget page's own explanatory comment and reported a false failure.
    // Replaced with spaces rather than deleted so offsets stay meaningful.
    const blank = (m) => m.replace(/[^\n]/g, ' ');
    const src = raw
      .replace(/<!--[\s\S]*?-->/g, blank)
      .replace(/\/\*[\s\S]*?\*\//g, blank);

    // Inherited from travelPortalStyles: .portal-content carries
    // overflow-y:auto and is the portal's own scroller.
    if (/class\s*=\s*["'][^"']*\bportal-content\b/.test(src)) {
      ok('a scroll container exists on ' + name, true);
      return;
    }

    // Otherwise the page must scroll its OWN content element. Checked against
    // the classes actually on <main>, not by grepping the file for
    // overflow-y:auto anywhere — the first version of this guard did that and
    // PASSED on a deliberately broken page, because the unrelated
    // .oc-modal__body rule satisfied it. A guard an unrelated rule can
    // satisfy is not a guard.
    const mainTag = /<main\b([^>]*)>/.exec(src);
    const cls = mainTag && /class\s*=\s*["']([^"']+)["']/.exec(mainTag[1]);
    const classes = cls ? cls[1].split(/\s+/) : [];

    const scrolls = classes.some((c) => {
      // A rule for this exact class that declares overflow-y:auto|scroll.
      const re = new RegExp(
        '\\.' + c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '\\b[^{}]*\\{[^}]*overflow-y\\s*:\\s*(auto|scroll)'
      );
      if (re.test(src)) return true;
      // Or inherited from any stylesheet the page includes.
      return walk(path.join(CLIENT, 'styles')).some((sf) => re.test(fs.readFileSync(sf, 'utf8')));
    });

    ok('a scroll container exists on ' + name,
       scrolls,
       !mainTag
         ? 'no <main> element found to carry the scroll'
         : `<main class="${classes.join(' ')}"> sits on a clipped body ` +
           '(html, body and .travel-portal-body all set overflow:hidden) but ' +
           'none of its classes declares overflow-y:auto, so nothing below ' +
           'the fold can be reached');
  });
}

console.log(fails ? ('\n' + fails + ' FAILURE(S)') : '\nALL ASSERTIONS PASSED!');
process.exit(fails ? 1 : 0);
