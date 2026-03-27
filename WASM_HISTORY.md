# Figma2Kv — WASM setup (historical, removed March 2026)

## What it was
Figma2Kv originally compiled a Swift executable to WASM and ran it inside the Figma plugin UI iframe.
The WASM module exposed `globalThis.figma2kv.convert(jsonString)` which called `FigmaMapper.convert(json:)` and returned a KV string.

## Why it was removed
Moved to a server-side model: plugin sends JSON to FigmaVaporServer, server does the conversion.
WASM is now unused. Plugin (figma4kivy) is pure TypeScript.

## Package.swift (old executable target)
```swift
dependencies: [
    .package(url: "https://github.com/swiftwasm/JavaScriptKit", from: "0.46.3"),
    .package(url: "https://github.com/Py-Swift/JavaScriptKitExtensions", branch: "master"),
]
targets: [
    .executableTarget(
        name: "Figma2Kv",
        dependencies: [
            "Figma2KvCore",
            .product(name: "JavaScriptEventLoop", package: "JavaScriptKit"),
            .product(name: "JavaScriptKit", package: "JavaScriptKit"),
            .product(name: "JavaScriptKitExtensions", package: "JavaScriptKitExtensions"),
        ],
        swiftSettings: [
            .swiftLanguageMode(.v5),
            .unsafeFlags(["-Xfrontend", "-disable-availability-checking"]),
        ]
    ),
]
```

## Sources/Figma2Kv/main.swift (old WASM entry point)
```swift
import JavaScriptKit
import JavaScriptEventLoop
import JavaScriptKitExtensions
import Figma2KvCore

JavaScriptEventLoop.installGlobalExecutor()

nonisolated(unsafe) var _convertClosure: JSClosure?
_convertClosure = JSClosure { args -> JSValue in
    guard let jsonStr = args.first?.string else { ... }
    do {
        let kv = try FigmaMapper.convert(json: jsonStr)
        let result = JSObject(); result.kv = kv.jsValue; return result.jsValue
    } catch {
        let result = JSObject(); result.error = "\(error)".jsValue; return result.jsValue
    }
}
let api = JSObject()
api.convert = _convertClosure!.jsValue
JSObject.global.figma2kv = api.jsValue
```

## vite.config.ts (old)
Used `@elementary-swift/vite-plugin-swift-wasm` to compile Swift→WASM during `vite build`.
Required env vars:
- `SWIFT_SDK_ID=swift-6.2.1-RELEASE_wasm`
- `CC=/usr/local/opt/llvm/bin/clang` (C shims for swift-numerics)
- `AR=/usr/local/opt/llvm/bin/llvm-ar`
- PATH prepended with `~/.swiftly/bin` so plugin uses swiftly-managed Swift 6.2.1

```ts
plugins: [swiftWasm({ useEmbeddedSDK: false })]
```

## BrowserRuntime (old, Figma2Kv/BrowserRuntime/)
Local npm package `elementary-ui-browser-runtime` that bootstrapped the WASM module.
Wired up: JavaScriptKit SwiftRuntime + WASI shim + BridgeJS stubs.
Called via `runApplication(initializer)` where initializer received the WebAssembly.Imports.

## inline-wasm.mjs (old, now just inline.mjs in figma4kivy)
Originally had two jobs:
1. Copy WASM binary into dist/ and patch import paths
2. Inline the JS bundle into index.html (Figma loads UI in a data: iframe with no base URL, so external `<script src>` silently fails)

After WASM removal, script only does step 2: find `dist/assets/*.js`, replace `<script src=...>` with inlined `<script type="module">`.

## WASM SDK install (CI, from release.yml)
```sh
curl -L https://download.swift.org/swift-6.2.1-release/wasm-sdk/swift-6.2.1-RELEASE/swift-6.2.1-RELEASE_wasm.artifactbundle.tar.gz -o wasm-sdk.tar.gz
swift sdk install wasm-sdk.tar.gz
# Then build:
SWIFT_SDK_ID=swift-6.2.1-RELEASE_wasm npm run build
```

## .swift-version
Pinned to `6.2.1` (swiftly). The system Swift was 6.2.3 (Xcode-bundled) which caused module cache mismatches.
Fix: `swift package clean` then rebuild, or ensure PATH puts swiftly's bin first.

## Key pain points encountered
- Swift 6.2.3 (Xcode) vs 6.2.1 (swiftly/WASM SDK) module cache mismatch → `swift package clean` required
- LLVM clang required for C targets (swift-numerics) — Xcode clang can't cross-compile to wasm32
- `@elementary-swift/vite-plugin-swift-wasm` reads `.swift-version` for the SDK ID
- Figma's plugin iframe has no base URL → all JS must be inlined into index.html

## Current state (after refactor)
- `Figma2Kv/` is now a pure Swift library (no WASM, no JavaScriptKit)
- Plugin is `figma4kivy/` — pure TypeScript, no WASM
- Conversion happens server-side in FigmaVaporServer via `FigmaMapper.convert(nodes:)`
