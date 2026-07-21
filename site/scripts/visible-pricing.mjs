import { parse, serialize } from "parse5";

function markupWithoutScriptElements(markup) {
  const document = parse(markup);
  const pending = [document];

  while (pending.length > 0) {
    const node = pending.pop();
    if (!node.childNodes) continue;

    node.childNodes = node.childNodes.filter((child) => child.nodeName !== "script");
    pending.push(...node.childNodes);
  }

  return serialize(document);
}

export function containsVisiblePrice(markup) {
  const visibleMarkup = markupWithoutScriptElements(markup);
  return /[$€£]\s?\d/.test(visibleMarkup)
    || /\d+\s?(?:\/|per\s+)(?:month|mo\b|year|yr\b|user|seat)/i.test(visibleMarkup);
}
