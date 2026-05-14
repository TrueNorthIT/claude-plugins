# GDS authoring rules

This file mirrors the `GDS_AUTHORING_RULES` constant in `api/_ai/_gdsRules.ts`. If the two ever drift, **that file wins** — it is the runtime source of truth used by the AI prompts. Update both when rules change.

Canonical sources (mirrored verbatim under `docs/gds/`):

- https://www.gov.uk/guidance/style-guide/a-to-z-of-gov-uk-style
- https://www.gov.uk/guidance/content-design/writing-for-gov-uk
- https://design-system.service.gov.uk/patterns/question-pages/

---

## Plain English and sentence shape

- Aim for a 9-year-old reading age.
- Sentences must be 25 words or fewer.
- Paragraphs must have no more than 5 sentences.
- Use the active voice. Address the user as "you".
- Be conversational but emotionless. Serious, not pompous.
- No jargon. Use the common short word, not the formal long one.

## Punctuation

- NEVER use em dashes (—) or en dashes (–). Use full stops or commas.
- NEVER use exclamation marks.
- NEVER use semicolons. Split into two sentences.
- Use "and" not "&" in body copy. Ampersands only in actual logos.
- Use "to" for ranges: "Monday to Friday", "9am to 5pm" — not hyphens or slashes.
- Single quotes for button names, unusual terms, and publication titles. Double quotes only for direct speech.
- One space after a full stop. No full stops in abbreviations (BBC, not B.B.C.).
- No full stop on the last bullet of a list. Bullets do not have semicolons or "and"/"or" between them.
- Avoid the (singular/plural) and "document(s)" forms. Use the plural.

## Capitalisation

- Always sentence case, including page titles, section headings, and service names.
- No block capitals.
- Capitalise proper nouns and named schemes only. "government", "minister", "council" stay lower case in general use.

## Contractions

- Use positive contractions: "you're", "we'll", "you'll", "it's".
- AVOID negative contractions: "cannot" not "can't"; "do not" not "don't"; "will not" not "won't"; "is not" not "isn't".

## Words to avoid (always use the replacement)

| Don't say | Say |
| --- | --- |
| submit, submission, submitting | send / sending. Buttons say "Accept and send", warnings say "By sending this form…". |
| complete (a form) | fill in |
| contact | speak to / get in touch |
| in order to | to (or remove) |
| prior to | before |
| regarding | about |
| utilise | use |
| facilitate | run, manage |
| liaise | work with |
| impact (verb) | affect |
| key (adjective) | important |
| robust | well thought out |
| streamline | simplify |
| transform | describe the actual change |
| provide | give |
| purchase | buy |
| assist | help |
| approximately | about |
| commence | start |
| please / please note | remove (instructions stand on their own) |

## Numbers, dates, times

- Numerals for all numbers including 2 to 9.
- 1,000 (with comma); 50%; 0.5 (with leading zero).
- £75; £75.50 (no .00); pence in full ("4 pence", not "4p" in body copy).
- Months in full ("4 June 2017"); upper case month; no comma before year.
- Times: "5:30pm", "9am to 5pm". Use "midnight" / "midday", not "12 noon".

## Form-page rules (GDS Design System: question pages pattern)

- Ask one question per page where you can.
- The page title and the question label should match when the page asks one question.
- Labels are direct questions or statements: "What is your name?" not "Please enter your name below".
- Hint text: a single short sentence. No full stops. No links inside hints.
- Mark optional fields with "(optional)". NEVER use asterisks for required fields.
- The "next page" button is labelled "Continue" — not "Next", not "Save and continue".
- The check-answers page heading is exactly "Check your answers". Do not append "before submitting" or similar.
- The accept-and-send button is "Accept and send".

## Headings (non-form guidance text outside gds-form blocks)

- Sentence case. No full stops. Front-load with the most important word.
- Do not use questions as guidance headings. Questions belong in form labels.
- Do not use "Introduction" as a first section. Just start with the most important information.
