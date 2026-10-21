# Record Room

<!-- impeccable:product-schema 1 -->

## Platform

web inside a standalone Electron desktop shell for Windows, macOS and Linux; optional local browser mode remains supported

## Users

The owner of an MPC1000 running JJOS3, an SP-404MKII and Maschine+, digging for sample material on a Windows computer.

## Product Purpose

Make exploring saved records feel like browsing sleeves and dropping a tonearm onto a record. The defining interaction is moving a working needle, not navigating a catalogue table.

## Operating Context

Import the user's Sample Digging favourites JSON. It contains 77 entries, YouTube identifiers, artist/title/channel, optional year and genre, and sample markers. The supplied export has no artwork URL or region and no nonzero saved selections. Display source thumbnails as source images, not verified album artwork.

## Capabilities and Constraints

Sixteen learned MPC pads place twelve needle positions (0–11/12 of the duration), gate random/current-position auditions on Pads 13/14, stop instantly on Pad 15 and toggle normal transport on Pad 16. Local momentary actions use direct play/pause, bypassing motor ramps and cancelling pending starts on release. Pad learning verifies release on 13/14, accepts notes or zero-release CC buttons, rejects conflicting assignments and saves per input name. Learn-all replacement is committed only when all 16 are complete; cancellation preserves the old profile. Streaming uses YouTube commands and cannot offer local-audio latency.

Two MPC1000 Q-Link sliders: one scans the recording; one controls pitch/speed. Learn CC and channel rather than invent defaults. The user confirmed whole-record scanning as the default; an optional 30-second window provides finer positioning. The official YouTube player supports seeking and discrete playback speeds but exposes no decoded audio for groove analysis. Explicit yt-dlp downloads and attached local audio enable analysed groove bands and continuous coupled speed/pitch. The imported file remains unchanged. Local media remains on the user's computer. Downloads only start through an explicit record or filtered-crate action.

Space starts or stops the record and R draws another record from the current filtered view. Both work from listening buttons and native pitch/position sliders; editable fields retain typing and sliders retain native arrow navigation. Random avoids repeats until its current cycle is exhausted. Clicking a record in either tab starts playback; initial restoration remains stopped. Natural completion plays the next record in the active filtered view, wrapping to the first. Manual stops, buffering, failures and held-pad auditions do not advance. Other programmatic source changes preserve the intended playing or stopped state.

For attached local audio, pitch changes glide continuously on the same source, with linked pitch and speed. Motor start and braking follow Quick, Natural (default), or Heavy timing; source position remains continuous when the user changes speed or reverses a brake. Streamed YouTube audio retains its supported stepped rates and normal start/stop behaviour.

Clicking a crate sleeve starts playback. A larger current-source thumbnail above the crate shows title, artist, year and genre, with honest playback state. Each sleeve has a separate YouTube/Pawn menu; Pawn removes membership with Undo while retaining downloaded audio and moments. Source badges reflect known playback or download errors, distinguishing unavailability, embedding restrictions and transient download problems. Imported crates fetch video thumbnails automatically; JSON does not package images or audio. The Downloads panel exposes the actual FLAC directory.

## Brand Commitments

Blend the user's Technics SL-1200 reference with Sungwoo Choi's Turntable(1) concept on Nothing Community. Keep the S-shaped tonearm, strobe-dot platter, pitch fader and transport arrangement, with a silver and transparent top-down deck, restrained white app shell, black dot-matrix display and small red operating accents. The counterweight must move with the tonearm and the strobe platter must follow actual motor speed. Keep Record Room's own identity and credit the independent concept as inspiration. Product name is a working name, not a confirmed brand.

The user explicitly requested command-line YouTube downloading for the crate. Provide an explicit single-record or filtered-crate queue backed by yt-dlp and FFmpeg, with persistent local audio, progress, cancellation and actionable failures. Reuse completed files and prefer them automatically on later selection. Do not download automatically on first launch or access browser cookies.

## Evidence on Hand

- C:/Users/thisi/Downloads/sampledigging_favorites.json
- C:/Users/thisi/AppData/Local/Temp/codex-clipboard-fb1e3e0d-e033-47fc-bfe0-bf7cd3ed7c44.png

## Product Principles

- Needle position must determine playback time.
- Show musical structure only when audio has actually been analysed.
- Preserve the source record, user markers and crate browsing position.
- Give hardware controls a clear learned mapping and honest connection state.
- Keep technical settings out of the listening surface until requested.

## Accessibility & Inclusion

Keyboard alternatives to dragging, labelled native controls, reduced motion support, readable status messages. Keep the primary workflow visible and concise.

## Discovery browser

My Crate and Dig tabs appear below the playing artwork, with independent persisted search/genre/year filters. D or Keep digging renews up to ten discovery records without interrupting playback. White/red supplied crate icons toggle saved membership. Discovery-only imports accept favourites-format JSON without saving every discovery. Dig reads public YouTube feeds from the supplied independent research list, expanded to 321 leads. It is not a verified Sample Digging export. Names and addresses needing resolution remain pending; supplied validation claims are preserved as research rather than trusted as live checks. Working sources populate a persistent local pool, and unresolved addresses do not block others. Imports retain cached records for sources still present. Feeds expose recent uploads; the user chose public-feed mode rather than configuring an API key for full-history indexing. Genre tags are channel hints; unambiguous years come from titles, never upload dates. Source details expose checks, pending counts and replacement imports. Listing checks download no media and use no Sample Digging private endpoint. Imported records remain a fallback; backups preserve that browsing collection separately from favourites.

## Desktop collection and channel management

The desktop app bundles its Python service, yt-dlp/EJS, trusted certificates, FFmpeg and a Node JavaScript runtime. It stores mutable data in the user's normal application-data directory, outside installed resources. The UI has no Node access; isolated preload exposes only the library backup and native download-folder actions to the trusted main frame. The service remains loopback-only. Windows keeps the tested WinMM input bridge; macOS/Linux use Web MIDI in the desktop browser engine.

Downloads has a persistent record collection folder, with native Choose folder and Open folder actions. Folder changes affect future downloads; manifest paths preserve previous completed audio. Queued/active work must finish or be cancelled before switching. Crate → Channel sources and Dig → Source → Manage channels open a searchable manager with add, edit, recent-record preview and remove/Undo. In-flight checks cannot restore a removed source. Removing sources keeps saved crate records, moments and audio. The user removed provenance and diagnostic counts from the listening UI; source-level status stays in the manager.
