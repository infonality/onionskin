import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * Token classes only — the actual colours live in CSS custom properties so a
 * single stylesheet drives both light and dark themes.
 */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], class: "tok-keyword" },
  { tag: [t.definitionKeyword, t.modifier, t.self], class: "tok-keyword" },
  { tag: [t.operatorKeyword, t.operator, t.derefOperator], class: "tok-operator" },
  { tag: [t.string, t.special(t.string), t.regexp], class: "tok-string" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tok-number" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: "tok-comment" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tok-function" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], class: "tok-def" },
  { tag: [t.typeName, t.className, t.namespace], class: "tok-type" },
  { tag: [t.propertyName, t.attributeName], class: "tok-property" },
  { tag: [t.tagName, t.angleBracket], class: "tok-tag" },
  { tag: [t.attributeValue], class: "tok-string" },
  { tag: [t.variableName, t.labelName], class: "tok-variable" },
  { tag: [t.constant(t.variableName), t.standard(t.variableName)], class: "tok-constant" },
  { tag: [t.punctuation, t.separator, t.bracket, t.paren, t.brace, t.squareBracket], class: "tok-punct" },
  { tag: [t.meta, t.processingInstruction], class: "tok-meta" },
  { tag: [t.escape, t.character], class: "tok-escape" },
  { tag: t.invalid, class: "tok-invalid" },
  { tag: t.link, class: "tok-link" },
]);

export const codeHighlighting = syntaxHighlighting(codeHighlightStyle);
