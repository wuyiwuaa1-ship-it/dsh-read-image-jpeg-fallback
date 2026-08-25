# dsh-read-image-jpeg-fallback

A [DSH](https://www.npmjs.com/package/@deepseek-ai/dsh) profile plugin: before a `read_image`
result reaches the model, it converts `image/png` and `image/webp` image blocks into an
**opaque sRGB JPEG** (quality 90) stored through the profile's attachment store.

## What it fixes

DSH's built-in attachment save-time normalization re-encodes some PNGs to WebP, and
LM Studio's `openai-completions` endpoint rejects the resulting WebP image URL:

```
400 'url' field must be a base64 encoded image.
```

With this plugin installed, the agent can `read_image` those files again: the model
receives a JPEG ref instead of the rejected WebP, and the conversation completes.

## Why this exists

- The WebP comes from DSH itself (attachment normalization), not from the user's file
  (a plain PNG is stored and then re-encoded at save time).
- LM Studio's endpoint is strict about which image formats it accepts.
- A profile-level function plugin is the least invasive fix: no DSH core change, no
  provider change, no re-encoding policy change — it only reshapes the image block of
  an already-accepted `read_image` result, and only for the media types that break.

## Supported / verified environment

- **DSH 0.1.1-rc.2** — plugin lifecycle, bundle auto-mounting, and composition were
  verified against this version's runtime source and isolated installs.
- **Node >= 22** (verified on Node 26.x); **pnpm on PATH** (`dsh plugin` forwards to
  pnpm; verified with pnpm 11.22.0).
- **LM Studio** `openai-completions` endpoint — both the 400 reproduction and the
  plugin's fix path were verified with real model round trips.
- **sharp 0.35.3** as a runtime dependency (platform prebuilt binaries — supported
  platforms are sharp's supported platforms).

This does not claim compatibility with every DSH version, every OpenAI-compatible
provider, or every WebP-related issue.

## Installation

Prerequisite: pnpm on PATH.

### From a tarball

```powershell
# from the directory containing the tarball (or pass any path to it)
dsh plugin --profile web add .\dsh-read-image-jpeg-fallback-0.1.0.tgz
```

### From npm (once published)

```powershell
dsh plugin --profile web add dsh-read-image-jpeg-fallback
```

The spec is passed through to `pnpm add` in the profile directory unchanged, so
`pnpm`-style specs (`name@version`, local tarball, ...) all work.

What happens automatically — no manual steps, no path knowledge needed:

- pnpm records the dependency in the profile's `package.json` + `pnpm-lock.yaml`;
- the plugin **and its runtime dependency sharp (including the platform prebuilt
  binary)** are installed into the profile's `node_modules`;
- DSH appends the package name to `dsh.profile.bundles` (see next section);
- the profile's own `cordis.patch.yml` stays untouched.

**Restart the DSH profile (e.g. DSH Web) after `add` or `remove`** — the bundle list
is read at profile boot.

## DSH bundle auto-loading

The package manifest declares:

```json
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

At profile boot, DSH resolves every entry of `dsh.profile.bundles` to its package
(first from the DSH installation, then from the profile's `node_modules`), reads the
declared patch path from the installed `package.json`, and composes that patch layer
in bundle order — after `@deepseek-ai/dsh-base` / the mode bundle, before the
profile's own `cordis.patch.yml`. The bundle's patch is a single row that registers
this plugin in the composed config. Nothing is copied, renamed, or hand-edited.

## Usage

Nothing to configure. In a profile with the plugin installed, use `read_image` as
usual — e.g. ask the agent to read an image file. Whenever an accepted `read_image`
result carries a `image/png` or `image/webp` image block, the model-visible content is
replaced with the converted JPEG before the provider request is built.

## Uninstallation

```powershell
dsh plugin --profile web remove dsh-read-image-jpeg-fallback
```

Then restart the profile. `dsh.profile.bundles`, the manifest dependency, the
lockfile entries, and the composed config are all cleaned up automatically; in the
tarball/registry install scenario pnpm also removes the plugin and sharp from the
profile `node_modules` completely.

## Known issue: uninstall can hang (Windows + pnpm 11.22.0 + hoisted profiles)

**Scope.** Reproduced on **Windows** with **pnpm 11.22.0** in a **DSH profile** —
every DSH profile is initialized with `nodeLinker: hoisted` in its
`pnpm-workspace.yaml` — and specifically when `remove` of this plugin makes pnpm
**prune sharp 0.35.3**. It is **not** claimed to affect all pnpm versions, all
Windows configurations, all DSH versions, or every remove (a remove that does not
prune sharp exits normally). The hang is **intermittent**: it reproduced 2/2 in
initial verification but did not reproduce in the 0.1.0 release verification
(clean exit, fully clean profile). The workaround below makes the remove robust
either way.

**Symptom.** pnpm completes all of its work — the dependency is removed from the
manifest, the lockfile is rewritten, the plugin directory is deleted from
`node_modules`, `Done in Xs` is printed — but the pnpm process then **never exits**.
`dsh plugin remove` waits on pnpm without a timeout, so the command hangs forever.
This is a pnpm teardown problem, not a plugin defect: after the hang, the disk state
is fully clean.

**Verified workaround.** Pin sharp as a *direct* dependency of the profile, so a
plugin `remove` never has to prune sharp:

```powershell
cd <DSH_HOME>\profiles\web
pnpm add sharp@0.35.3
```

Once pinned, the normal lifecycle works end to end:

```powershell
dsh plugin --profile web add dsh-read-image-jpeg-fallback
# ... use ...
dsh plugin --profile web remove dsh-read-image-jpeg-fallback
```

pnpm exits normally, DSH reconciles `dsh.profile.bundles`, and the bundle is
unmounted automatically. The sharp pin remains in the profile as a direct dependency
after the plugin is gone; leaving it in place is harmless.

**If you hit the hang anyway** (no pin): after `Done in Xs` is printed, all physical
work is already done — wait briefly, then kill the hanging `dsh`/`pnpm` process
chain. Recover the profile state by either:

- keeping the plugin: re-run `dsh plugin --profile web add <package>` (exit 0, state
  becomes consistent again); or
- finishing the uninstall: edit `profiles\web\package.json` and remove the
  `"dsh-read-image-jpeg-fallback"` entry from `dsh.profile.bundles` (the dependency,
  lockfile, and `node_modules` were already cleaned by pnpm before the hang).

## What the plugin changes

Only the **model-visible image block content** of an accepted `read_image` result:
the image block is re-pointed at a new attachment ref whose bytes are the converted
JPEG (`image/jpeg`). That replaced content is what the session persists, what the
provider request carries, and what the UI renders.

## What it deliberately does not change

- The canonical tool result value (the old ref is left untouched — it is not
  persisted and not sent to the model).
- Attachment metadata, session text, or any non-`read_image` tool call.
- The `read_image` text envelope line (old byte count / media type) keeps its
  original values — a cosmetic residue, by design the spec replaces the image block
  only.

## Supported input media types

- **Converted (and only these):** `image/png`, `image/webp` — via
  `sharp().rotate().toColourspace('srgb').flatten(white background).jpeg({quality: 90})`,
  producing an opaque sRGB JPEG.
- **Pass-through, byte-identical decision:** `image/jpeg`, `image/gif`,
  `image/svg+xml`, `image/avif`, and every other media type — no re-encoding, no GIF
  decoding, no double conversion (a clean opaque sRGB JPEG re-enters the
  normalization unchanged).

## Failure behavior

Any failure along the way (attachment store missing, read, conversion, or save)
degrades to the **original result** with a `warn` in the profile log — the hook never
turns a successful call into an error. A missing sharp degrades to pass-through
(lazy import) instead of failing profile boot.

## Development / validation

All paths relative to this repository root.

```powershell
# 1) Static media-type gating (stub ctx, zero model requests):
node test\gating-test.mjs

# 2) Pre-publish chain (metadata sanity, pack, tarball audit, two isolated
#    DSH_HOME installs — one without the sharp root pin (remove must land in
#    one of the two documented states: clean exit or the documented hang),
#    one with the pin expecting a clean remove, gating, then the smoke):
powershell -ExecutionPolicy Bypass -File test\release-check.ps1
powershell -ExecutionPolicy Bypass -File test\release-check.ps1 -SkipSmoke
#    -SkipSmoke skips the model smoke (everything else is zero-model).

# 3) Isolated tarball install lifecycle only (fresh DSH_HOME, zero model):
powershell -ExecutionPolicy Bypass -File test\tarball-install-test.ps1

# 4) read_image smoke against LM Studio (REAL model round trips; requires LM Studio
#    running and the LMSTUDIO_API_KEY in the real DSH home's credential store):
powershell -ExecutionPolicy Bypass -File test\smoke.ps1
```

Local development install (`link:`) is for plugin developers only; end users should
install the tarball or the registry package. Two caveats:

1. pnpm does not install a `link:` package's dependencies — run
   `pnpm --dir <this repo root> install` once so the plugin's `import('sharp')`
   resolves from the source tree.
2. After `remove`, the profile `node_modules` may keep one **inert** junction
   (pnpm bookkeeping for `link:` deps); it has no functional effect on DSH.

## Package contents (the tarball carries exactly these 5 files)

```
package.json          # name/version/license/exports/files, "dsh": { "bundle": { "patch": ... } },
                      #   dependencies: sharp ^0.35.3 (standard runtime dependency)
jpeg-image-fix.mjs    # the plugin (only product file)
cordis.patch.yml      # the bundle patch layer (one insert row)
README.md
LICENSE               # MIT
```

Test scripts, fixtures, evidence, scratch homes, `node_modules`, and lockfiles are
never part of the published package.

## License

MIT — see the `LICENSE` file at the package root (`"license": "MIT"` in
`package.json`).
