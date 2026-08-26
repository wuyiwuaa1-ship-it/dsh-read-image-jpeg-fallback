# dsh-read-image-jpeg-fallback

A zero-configuration **DSH image compatibility shim** for LM Studio.

It keeps DSH's native `read_image` + multimodal-model flow intact, but transparently converts PNG/WebP tool attachments to opaque sRGB JPEG before the next provider request is built.

Use it when your **main model already supports images**, but LM Studio's `openai-completions` route rejects a DSH image attachment with an error such as:

```text
400 'url' field must be a base64 encoded image
```

> This is a media-format compatibility plugin, **not** a vision model, OCR plugin, or image-to-text fallback.

## Why this exists

In some DSH + LM Studio paths, `read_image` can produce a PNG/WebP image block that later reaches the provider request in a format LM Studio does not accept.

This plugin fixes only that transport mismatch:

```text
read_image
    ↓
DSH image attachment
    ↓
PNG / WebP ?
    ├─ no  → pass through unchanged
    └─ yes → opaque sRGB JPEG (quality 90)
                    ↓
          same multimodal model
```

The model still receives the image itself. There is no OCR step, no auxiliary VLM call, and no conversion to a text description.

## What makes it different

| Approach | What happens to the image | Main model path |
| --- | --- | --- |
| **This plugin** | PNG/WebP is re-encoded to JPEG | Preserved; the same multimodal model receives the image |
| Vision fallback plugins | Image is sent to another VLM and usually converted to text | Main model receives a description/result |
| OCR / image-reader plugins | Image is analyzed by dedicated tools | Main model consumes tool output |
| Separate LM Studio vision tools | Agent calls a dedicated vision tool/model | Bypasses the native `read_image` → current-model path |

This plugin is intentionally narrow: it is useful when the native DSH vision path is already the behavior you want and only the image encoding is incompatible.

## What it does

The plugin hooks into DSH after a successful `read_image` tool call and converts model-visible image blocks as follows:

- `image/png` → opaque sRGB JPEG
- `image/webp` → opaque sRGB JPEG
- JPEG and other media types → unchanged

It does **not** replace the built-in `read_image` tool or patch DSH core source.

The conversion itself is local. The resulting JPEG then follows your existing DSH/provider request path.

## When to use it

This plugin is a good fit when all of the following are true:

- your selected/main model already supports image input;
- you use LM Studio through an OpenAI-compatible `openai-completions` route;
- `read_image` works until the following model request is built, then fails on the image attachment;
- you want to preserve the native multimodal flow instead of routing the image through another vision model.

You probably do **not** need it if your provider already accepts the image formats DSH sends, or if your main model is text-only and you actually need a vision fallback/OCR solution.

## Installation

Requires:

- DSH `0.1.1-rc.2`
- Node.js `>= 22`
- `pnpm` available on PATH

### From npm

```powershell
dsh plugin --profile web add dsh-read-image-jpeg-fallback
```

### From GitHub

```powershell
dsh plugin --profile web add github:wuyiwuaa1-ship-it/dsh-read-image-jpeg-fallback
```

To pin the current main branch explicitly:

```powershell
dsh plugin --profile web add github:wuyiwuaa1-ship-it/dsh-read-image-jpeg-fallback#main
```

### From a tarball

```powershell
dsh plugin --profile web add .\dsh-read-image-jpeg-fallback-0.1.1.tgz
```

Restart DSH Web after installation.

## Usage

No configuration is required.

Use `read_image` normally. When its successful result contains a PNG or WebP image block, the plugin creates a JPEG replacement for the model-visible attachment before the next provider request is built.

There is no new model-facing tool to learn and no change to the normal agent workflow.

## Failure behavior

The plugin is designed to **fail open**.

If reading, converting, or saving the replacement image fails:

- the original `read_image` result is preserved;
- a warning is written to the DSH log;
- a successful tool call is not converted into a plugin error.

## Supported environment

Verified with:

- DSH `0.1.1-rc.2`
- LM Studio `openai-completions`
- Node.js 26.x
- `sharp` `0.35.3`
- Windows

Compatibility with other DSH versions, operating systems, or providers is not guaranteed unless explicitly tested.

## Known issue

On some Windows + pnpm setups, removing the plugin may hang after pnpm has already completed its filesystem changes, particularly when `sharp` is being pruned.

If this occurs, pinning `sharp` directly in the DSH profile avoids the issue:

```powershell
cd <DSH_HOME>\profiles\web
pnpm add sharp@0.35.3
```

## Uninstall

```powershell
dsh plugin --profile web remove dsh-read-image-jpeg-fallback
```

Restart DSH Web afterwards.

## How it works

The plugin uses DSH's `tools/post-execute` hook.

For accepted `read_image` results containing PNG or WebP image blocks, it:

1. reads the stored attachment;
2. converts it with `sharp` to opaque sRGB JPEG at quality 90;
3. saves a new attachment through DSH's attachment store;
4. replaces only the model-visible image block with the new JPEG reference.

The canonical tool result and built-in `read_image` implementation remain untouched.

## Scope

The goal is deliberately small: provide a transparent image-format compatibility layer until the provider/host path accepts the original media format directly.

If upstream DSH or LM Studio gains equivalent handling, this plugin may become unnecessary for that configuration.

## License

MIT
