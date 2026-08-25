/**
 * jpeg-image-fix — minimal profile function plugin (audit Plan A).
 *
 * Background: dsh-attachment-local's save-time normalization re-encodes PNG
 * input to WebP (sharp reports `icc: null` for profile-less PNGs and
 * `carriesRetainedMetadata` treats that as retained metadata). LM Studio's
 * openai-completions endpoint rejects the resulting WebP attachment with
 * `'url' field must be a base64 encoded image.` — see
 * `docs/read-image-jpeg-fix-feasibility-audit.md`.
 *
 * Fix: a `tools/post-execute` waterfall listener (prepended, delegate-first)
 * that, for `read_image` results whose image block carries a conversion
 * target media type (`image/png` or `image/webp` — and only those), converts
 * the stored attachment to an opaque sRGB JPEG (q90) through the same
 * `attachments.saveImage` the built-in tool uses, and returns an
 * `{kind: 'accept', content}` decision whose image block points at the new
 * ref. The replaced content is what the session log persists, what pi-ai
 * turns into the provider request, and what the UI renders. The canonical
 * `value` (old ref) is left untouched by design — it is not persisted or
 * sent.
 *
 * Safety properties:
 * - Only `image/png` and `image/webp` are converted; every other media type
 *   (JPEG, GIF, …) passes through unchanged.
 * - A clean opaque sRGB JPEG passes save-time normalization byte-identical;
 *   worst case the encoder re-enters the JPEG ladder (q85/80/75) — the WebP
 *   branch is unreachable for an opaque non-low-colour source.
 * - Any failure (missing store, read, convert, or save) degrades to the
 *   original result; the hook never turns a successful call into an error.
 * - The frozen result is never mutated; the decision's return value is the
 *   only channel.
 *
 * Function-plugin contract (no default export): named exports
 * `name` / `inject` / `apply`.
 */

export const name = 'jpeg-image-fix';

/** The tool registry — its `tools/post-execute` waterfall is the hook point. */
export const inject = ['tools'];

/** The only media types this hook converts; all others pass through. */
const CONVERSION_TARGETS = ['image/png', 'image/webp'];

/**
 * @param ctx - the plugin context.
 */
export function apply(ctx) {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    // Delegate first so downstream listeners settle the result; this hook only
    // shapes accepted read_image results that still carry a conversion-target
    // image (image/png or image/webp).
    const decision = await next();
    if (exec.name !== 'read_image') return decision;
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value')) return decision;

    const content = decision.content ?? result.content;
    const index = content.findIndex((block) => block.type === 'image' && block.attachment !== undefined);
    if (index === -1) return decision;
    const ref = content[index].attachment;
    if (!CONVERSION_TARGETS.includes(ref.mediaType)) return decision;

    // Optional service: a deployment without an attachment store cannot have
    // produced an image block, but degrade regardless.
    const attachments = ctx.get('attachments');
    if (attachments === undefined) return decision;

    try {
      // Lazy import: a missing sharp degrades to pass-through instead of
      // failing boot. Resolution walks up from this file to the profile's
      // flat module fallback ($DSH_HOME/profiles/node_modules), which carries
      // sharp on every DSH home.
      const { default: sharp } = await import('sharp');
      const stored = await attachments.readImage(ref);
      const jpeg = await sharp(Buffer.from(stored.data))
        .rotate()
        .toColourspace('srgb')
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality: 90 })
        .toBuffer();
      const newRef = await attachments.saveImage({
        data: new Uint8Array(jpeg),
        mediaType: 'image/jpeg',
        ...ref.name === undefined ? {} : { name: ref.name }
      });
      const replaced = content.map((block, i) => (i === index ? { type: 'image', attachment: newRef } : block));
      return {
        kind: 'accept',
        content: replaced,
        ...decision.additionalContexts !== undefined ? { additionalContexts: decision.additionalContexts } : {}
      };
    } catch (error) {
      ctx.logger?.warn(`jpeg-image-fix: conversion failed for ${String(ref.attachmentId)}: ${String(error)}; keeping the original attachment`);
      return decision;
    }
  }, { prepend: true });
}
