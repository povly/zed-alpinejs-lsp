; ── Alpine directives: inject JS into attribute values ───────────────────
; x-data, x-init, x-show, x-if, x-for, x-text, x-html, x-effect, x-modelable
; (x-teleport, x-ref, x-transition are intentionally excluded — their values
; are CSS selectors or class names, not JS expressions)
(attribute
  (attribute_name) @_attr
  (#match? @_attr "^x-data$|^x-init$|^x-show$|^x-if$|^x-for$|^x-effect$|^x-text$|^x-html$|^x-modelable$")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript")
  (#set! injection.include-unnamed-children true))

; x-bind:* and x-model:* (value is a JS expression)
(attribute
  (attribute_name) @_attr
  (#match? @_attr "^x-bind|^x-model")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript")
  (#set! injection.include-unnamed-children true))

; x-on:* (value is a JS statement / handler body)
(attribute
  (attribute_name) @_attr
  (#match? @_attr "^x-on")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript")
  (#set! injection.include-unnamed-children true))

; Shorthand @event="..." (x-on shorthand → JS)
(attribute
  (attribute_name) @_attr
  (#match? @_attr "^@")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript")
  (#set! injection.include-unnamed-children true))

; Shorthand :attr="..." (x-bind shorthand → JS)
(attribute
  (attribute_name) @_attr
  (#match? @_attr "^:")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript")
  (#set! injection.include-unnamed-children true))

; ── Standard HTML injections (mirrors Zed built-in HTML) ─────────────────
(script_element
  (raw_text) @injection.content
  (#set! injection.language "javascript"))

(style_element
  (raw_text) @injection.content
  (#set! injection.language "css"))

(attribute
  (attribute_name) @_attribute_name
  (#match? @_attribute_name "^style$")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "css"))

(attribute
  (attribute_name) @_attribute_name
  (#match? @_attribute_name "^on[a-z]+$")
  (quoted_attribute_value
    (attribute_value) @injection.content)
  (#set! injection.language "javascript"))

((comment) @injection.content
  (#set! injection.language "comment"))
