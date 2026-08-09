; ── Standard HTML ──────────────────────────────────────────────────────────
(tag_name) @tag
(attribute_name) @attribute
(attribute_value) @string
(comment) @comment
(doctype) @tag.doctype
"<" @punctuation.bracket
">" @punctuation.bracket
"</" @punctuation.bracket
"/>" @punctuation.bracket
"=" @operator

; ── Alpine directives (x-data, x-show, x-model, ...) ──────────────────────
(attribute
  (attribute_name) @keyword
  (#match? @keyword "^x-"))

; ── Alpine shorthand :attr (x-bind shorthand) ─────────────────────────────
(attribute
  (attribute_name) @keyword
  (#match? @keyword "^:"))

; ── Alpine shorthand @event (x-on shorthand) ──────────────────────────────
(attribute
  (attribute_name) @keyword
  (#match? @keyword "^@"))
