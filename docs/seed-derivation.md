# Future submission seed derivation

Before scoring, publish the locked rule text and derivation marker. The canonical
document is UTF-8 without BOM, with LF line endings, constructed as follows:

1. `mini-formula-arena-seeds-v1\n`
2. `rules-bytes:<decimal byte length>\n`, followed immediately by the exact
   locked rule text bytes, followed by `\n`.
3. `submission-sha256:<64 lowercase hex digits>\n`, where the digest is of the
   exact submitted file bytes.
4. `marker-bytes:<decimal byte length>\n`, followed immediately by the UTF-8
   bytes of the published marker, followed by `\n`.

For block counter 0, 1, 2, ... hash SHA-256 over that canonical document
followed by `block:<decimal counter>\n` in UTF-8. Read each digest from left to
right in eight-character hexadecimal chunks, interpreting each as an unsigned
32-bit integer. Skip zero and values already selected for this submission;
continue through blocks until the published number of seeds is obtained. Publish
the complete input document, marker, submission hash and resulting seed list.
The practice seed 7 is not a round-2 seed. Future official seeds are not in
this package.
