# Note templates

`built_in_templates()` provides seven original templates; `Template::default()`
selects the adaptive `auto` template. JSON and TOML methods encode/decode template
text; the application owns file selection and filesystem persistence.

Use `build_enhance_prompt` for a single request, or `plan_enhancement` for a
transcript with a text token budget. The estimate is four Unicode characters per
token. The budget covers transcript text: callers must reserve additional model
context for metadata, instructions, notes, supporting context, and generated output.

For `EnhancePlan::Direct`, send its system and user strings to the chosen
provider. For `MapReduce`, complete each map prompt first, collect the returned
summary strings in order, and pass them with the plan's stored template and input
to `build_reduce_prompt`. Complete that combined prompt to produce the final
notes. Provider execution belongs to the application; this crate has no network
or provider dependency. For very large map outputs, callers can reduce in further
batches to fit their selected model's context window.

Chunking preserves segment identifiers, including when splitting an oversized
segment. Citation parsing returns Markdown headings and unique supporting segment
indices in encounter order, ignoring fenced code and malformed citations.
