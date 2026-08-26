# dsh-read-image-jpeg-fallback

A small DSH profile plugin that converts `read_image` PNG/WebP attachments to JPEG before they are sent to the model.

It is intended for LM Studio setups where DSH-generated WebP attachments cause:

```text
400 'url' field must be a base64 encoded image
```

## What it does

DSH may normalize PNG screenshots into WebP before building the model request.

Some LM Studio `openai-completions` routes reject those WebP image attachments.

This plugin hooks into `read_image` after the tool finishes and converts:

- `image/png` → opaque sRGB JPEG
- `image/webp` → opaque sRGB JPEG

JPEG and other media types are left unchanged.

The built-in `read_image` tool itself is not replaced or modified.

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

Use `read_image` normally. When its result contains a PNG or WebP attachment, the plugin converts the model-visible image to JPEG before the next provider request is built.

```text
read_image
    ↓
DSH attachment
    ↓
PNG / WebP ?
    ├─ no  → pass through
    └─ yes → opaque sRGB JPEG (quality 90)
                    ↓
                 model
```

## Failure behavior

The plugin is designed to fail open.

If reading, converting, or saving the replacement image fails, the original `read_image` result is preserved and a warning is written to the DSH log.

It does not turn a successful tool call into a plugin error.

## Supported environment

Verified with:

- DSH `0.1.1-rc.2`
- LM Studio `openai-completions`
- Node.js 26.x
- sharp `0.35.3`
- Windows

Compatibility with other DSH versions or providers is not guaranteed.

## Known issue

On some Windows + pnpm setups, removing the plugin may hang after pnpm has already completed its filesystem changes, particularly when `sharp` is being pruned.

If this occurs, pinning sharp directly in the DSH profile avoids the issue:

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

## License

MIT
