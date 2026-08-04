/* Tiny DOM helpers. Deliberately minimal — no framework, no templating. */

/**
 * el('button.btn.primary', { onclick }, 'Start')
 * Tag string supports an optional CSS-ish `.class` suffix list.
 */
export function el(spec, props = {}, ...children) {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');

  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className += (node.className ? ' ' : '') + value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list') node[key] = value;
    else node.setAttribute(key, value);
  }

  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/**
 * Replace a container's contents.
 *
 * Use this instead of `node.replaceChildren(...)` / `node.append(...)` for
 * anything with a conditional child: the native methods stringify non-nodes,
 * so a `cond ? el(...) : null` child renders the literal text "null".
 */
export function mount(node, ...children) {
  node.replaceChildren(
    ...children.flat().filter((c) => c != null && c !== false),
  );
  return node;
}

/** 125 -> "2:05". Always at least M:SS. */
export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** '2026-08-04' -> 'Tue 4 Aug'. */
export function formatDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
