---
name: Record Room
description: A silver physical listening deck in a quiet white record crate.
colors:
  shell: "#f8f8f8"
  paper: "#282828"
  muted: "#666666"
  line: "#dfdfdf"
  surface: "#ffffff"
  silver: "#d9d9d9"
  cue: "#474747"
  focus: "#595959"
  problem: "#545454"
  ink: "#f6f6f6"
  transport: "#323232"
  transport-hover: "#505050"
  hardware-signal: "#f35a4f"
  matrix-black: "#101212"
  matrix-dot: "#e4ece5"
  matrix-dim: "#242b27"
  matrix-cursor: "#d58278"
typography:
  wordmark:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "22px"
    fontWeight: 650
    letterSpacing: "-.8px"
  title:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "28px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "-.9px"
  body:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "14px"
    lineHeight: 1.5
  control:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "13px"
  sleeve-title:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 550
    lineHeight: 1.45
  metadata:
    fontFamily: "Manrope, 'Segoe UI', sans-serif"
    fontSize: "12px"
    lineHeight: 1.45
rounded:
  square: "0"
  sleeve: "2px"
  key: "3px"
  moment: "5px"
  control: "6px"
  panel: "10px"
  module: "12px"
  circle: "50%"
spacing:
  compact: "8px"
  inline: "12px"
  control: "14px"
  panel: "20px"
  shell-edge: "36px"
  room-gap: "48px"
components:
  play-button:
    backgroundColor: "{colors.transport}"
    textColor: "{colors.surface}"
    rounded: "{rounded.circle}"
    width: "48px"
    height: "48px"
  play-button-hover:
    backgroundColor: "{colors.transport-hover}"
  tool-button:
    textColor: "#363636"
    rounded: "{rounded.control}"
    padding: "9px 13px"
  download-button:
    backgroundColor: "#3b3b3b"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "9px 14px"
  search:
    backgroundColor: "{colors.surface}"
    textColor: "#454545"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "#424242"
    rounded: "5px"
    padding: "8px 28px 8px 10px"
  record-speed:
    backgroundColor: "{colors.surface}"
    textColor: "#424242"
    padding: "8px 28px 8px 10px"
  crate-tab:
    textColor: "#737373"
    rounded: "{rounded.square}"
    padding: "6px 0 10px"
  sleeve:
    textColor: "#464646"
    rounded: "{rounded.square}"
    padding: "0"
  moment:
    backgroundColor: "#eaeaea"
    textColor: "#4b4b4b"
    rounded: "5px"
  record-options:
    textColor: "{colors.surface}"
    width: "44px"
    height: "44px"
  current-source:
    textColor: "{colors.paper}"
    padding: "0 0 18px"
  record-jump:
    textColor: "#363636"
    rounded: "5px"
    padding: "5px 0"
  download-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "24px 28px"
  matrix:
    backgroundColor: "{colors.matrix-black}"
    textColor: "{colors.matrix-dot}"
---

# Design System: Record Room

## Overview

**Creative North Star: "The Transparent Listening Machine"**

A top-down silver turntable brings the familiar SL-1200 arrangement together with the transparent panels and separate dot-matrix module of Sungwoo Choi's Turntable(1) concept. Five user-supplied transparent photoreal PNG layers provide the cleaned chassis with integrated gimbal, vinyl, moving tonearm cutout, tempo-slider thumb and lighting; a circular canvas provides the strobe platter. The working S-shaped arm, moving counterweight, strobe platter and live physical controls establish the identity. Record Room remains its own working product name; the independent concept is credited as inspiration.

A quiet silver-white surround gives the machine room to breathe. Self-hosted Manrope, graphite controls, thin neutral dividers and square source thumbnails support record selection and listening. The application uses neutral selection, playback, feedback and keyboard-focus states; the supplied machine retains its physical material details. The black matrix is a live instrument: its time, speed, source, motor state and local waveform describe the actual recording and engine.

**Key Characteristics:**

- Silver and transparent physical hardware inside a flat white application shell.
- One mechanically coherent deck, with a black dot-matrix display beside it.
- Manrope typography and neutral graphite application controls, with physical hardware detail confined to the instrument.
- Source thumbnails, waveform analysis and download states tied to real data.

This document records the built cascade in `style.css`, `listening.css`, `minimal.css`, then `supplied.css`, plus `index.html`, `app.js`, `matrix.js`, `mechanics.js` and the shared `presentation.js` geometry and speed mappings. `minimal.css` owns the neutral application shell and `supplied.css` owns the final physical asset composition. Earlier dark-room declarations remain implementation history, not design authority. Frontmatter owns primitives; `.impeccable/design.json` adds previews, material depth, motion and responsive metadata.

## Colors

Silver-white surfaces, graphite text and quiet grey states define the application. Green is absent from the new application controls; imported source images and existing physical canvas/material colors retain their source truth.

### Primary

- **Graphite cue** (`cue`): source links, text actions and the MIDI connection action. **Transport graphite** (`transport`, `transport-hover`): primary play and its hover state.
- **Hardware signal** (`hardware-signal`): the existing physical speed indicator; supplied image reds belong to the machine rather than application feedback.

### Neutral

- **Workspace white** (`shell`), **Surface white** (`surface`) and **Fine divider** (`line`): the room, fields/panels and working boundaries.
- **Reading graphite** (`paper`) and **Secondary grey** (`muted`): hierarchy and metadata. **Keyboard grey** (`focus`) defines visible focus; **Problem graphite** (`problem`) keeps issue labels readable without introducing a new app accent.
- **Machined silver** (`silver`) and **Light-on-dark ink** (`ink`): retained material and inverse-text primitives. **Matrix black**, **Matrix dot**, **Matrix dim** and **Matrix cursor** retain the existing live instrument palette.

**The Operating Signal Rule.** Use graphite and neutral grey for application actions, selection, focus and feedback; keep material colors inside the physical instrument or source imagery.

## Typography

**Application font:** self-hosted Manrope, then Segoe UI and sans-serif. `assets/Manrope.ttf` supplies weights 200–800 with `font-display: swap`; `assets/Manrope-OFL.txt` retains the SIL Open Font License 1.1. The loaded legacy Oswald face does not define this hierarchy.

### Hierarchy

- **Wordmark:** 22px, weight 650, with tightened tracking; 19px on phones.
- **Record title:** 28px, weight 550, 1.2 line height and 45ch maximum; 25px in compact desktop layouts, 26px in stacked layouts and 24px on phones. The crate title is 23px, becoming 25px on phones.
- **Current record:** 18px, weight 550, two lines maximum; 20px on phones. Metadata follows at 12px, or 13px on phones.
- **Body / control:** 14px base, 13px working controls and 12px support text. Phone body and native form text reach 16px; helper text stays 12–13px. Status copy retains a 65ch maximum and a 1.6 line height.
- **Sleeve title / metadata:** 13px medium titles with 1.45 line height and 12px metadata; phone titles become 14px. Timing, pitch, jump digits and moments use tabular numerals.
- **Matrix / engraving:** retain the hand-authored 5-by-7 dot alphabet and container-relative physical lettering. Adjacent readable controls provide the operating alternatives.

**The One Interface Voice Rule.** Use Manrope for application work; confine dot lettering and miniature engraving to the physical instrument.

## Layout

The desktop room is centred at a maximum 1840px, with padding `28px 36px 40px`, a 48px column gap and a flexible listening column beside a crate width of `clamp(330px,31vw,470px)`. A sticky 72px header keeps Crate, Downloads and MIDI available. Between 851px and 1180px, the crate is 300px, room padding is 24px/22px and the gap is 28px.

The deck's source geometry remains exact: 1200/1060 inner aspect ratio, 80% mechanical deck and an absolute 20% display sidecar. The housing occupies the listening column up to 920px wide. Preserve the machine as the dominant centerpiece even when secondary controls fall below the first desktop viewport; do not shrink it to fit every control above the fold. The three sidecar elements retain space-evenly vertical spacing, full-width 2/3 matrix and equal 80%-width round play/grille elements, including on phones.

The desktop crate sticks at top 100px with height `calc(100svh - 132px)` and a flexible independently scrolling sleeve grid. It has two sleeve columns, becoming three from 1350px. A current-source thumbnail above the filters is 120px square, smaller in compact/short desktop layouts. Search, filters and view controls stay outside the scrolling grid.

At 850px and below, listening and crate become one document flow. The crate loses sticky positioning and internal scrolling; three sleeve columns become two on phones at 540px. A fixed bottom dock keeps playback, Keep, Deck and Crate navigation within reach, with safe-area padding and reserved document space. The sticky header is 68px. Phone side padding is 16px, the source plate is 156px square, jump buttons form two rows of five, and important controls use 44px or larger targets. The pinned physical cue keeps its separate 24px minimum target.

The working strip has four labelled groups: Scan, Pitch/Speed, Record speed and Motor feel. At 1180px and below they form a 2-by-2 arrangement, retaining the same order. Kept moments and removal Undo sit immediately below transport. Source player/details disclose separately: stream mode opens the actual YouTube player; local mode can keep these details closed. Download lists have their own bounded scroll area, while the page and phone crate retain normal document scrolling.

## Elevation & Depth

The application uses borders, whitespace and tonal separation. The supplied photoreal layers carry the machine's silver reflections, transparent plates and mechanical detail. The outer wrapper and inner deck have no box shadow; the chassis image receives `drop-shadow(0 6px 5px #0002)`. The moving arm has `drop-shadow(2px 4px 2px #0004)`, increasing to `drop-shadow(4px 9px 3px #0005)` while dragged. The authored display module and jog wheel retain subtle gradients and contact shadows; the tempo thumb uses the supplied photographic metal artwork above the cleaned chassis track. Sleeve images have no resting box shadow and remain still on hover so their separate options button stays aligned.

**The Material Boundary Rule.** Reserve gradients, transparent layers, perforations and nested hardware groups for the physical machine; organize application controls with neutral surfaces and dividers.

## Shapes

The supplied chassis establishes its transparent physical silhouette. Its HTML wrapper and deck are transparent and unrounded. The separate display module uses a 12px radius, reduced to 7px on phones; its black bezel keeps the concept's asymmetrical rounding. Controls use the control radius; download and setup panels are modestly rounded. Sleeve buttons and crate views stay square, with slight image corners. Circles belong to vinyl, label, spindle, pivots, jog wheel, grille, identity mark and transport play.

Geometry is a shared functional contract in source coordinates. Full-deck layers use viewBox `20 65 1200 1060`. The record centre is (530,555), radius 397, arm pivot (1052,321) at the cleaned bearing and transformed stylus (939,962). Platter well: left 5.666667%, top 4.528302%, width 73.666667%; record: left 9.416667%, top 8.773585%, width 66.166667%. The improved chassis contains the fixed gimbal directly. The moving cutout is translated upward by eight source pixels to align its bolt with the cleaned bearing; no subtraction mask or approximate moving-arm clip is used. The moving image is un-clipped and keeps the counterweight and headshell intact. It ignores pointer events; a transparent 36px-stroke hit path handles arm dragging. Rotation solves the real stylus arc from the outer groove to the inner runout, with a -6° cue-lift offset. Keep the source crop, moving-arm translation and solver synchronized.

## Components

### Physical deck and live matrix

Record and arm accept dragging; the arm is also a labelled keyboard slider. Authored pitch, cue, 33/45 and start/stop controls align with the supplied physical images. The supplied tempo-thumb PNG follows an invisible native vertical range above the clean track. The source track spans y=602..965 and the thumb is 67 source pixels high. Its artwork uses a 0.5-source-pixel horizontal offset and vertical offset `17 - value / 8 * 148`; normal speed sits at the centre. Local mode maps the range to continuous pitch. Streaming maps it to the nearest supported YouTube speed using separate scales below and above 1x; arrow keys step between adjacent supported rates and Reset returns to normal. Fader and reset disable while loading or when the stream has no adjustable speed choices. The invisible native range remains keyboard-operable; a separate outline marks keyboard focus. The transparent reset button is centred at source (1066,897), matching the painted circle; its target is 54 by 54 source pixels. Full-size pitch and reset controls remain below the deck. The exact circular strobe canvas and record label advance at 200 degrees per second multiplied by actual motor rate: normal speed is 33⅓ RPM and 45 is 1.35 times normal. The supplied vinyl image has only a gentle sway from -1.5° to +1.5° over eight seconds, alternating with ease-in-out timing. It runs while playing and pauses while stopped. Continuous rotation belongs only to the strobe and label. A concentric dark uncut runout is 46% of the record diameter, positioned at left/top 27%, surrounding the centred 35% label at left/top 32.5%. The groove canvas, stylus solver and pointer seeking share outer radius .487 and inner radius .235 of record diameter through `presentation.js`; musical groove lines stop outside the uncut runout. These concentric layers cover the source image's offset baked label. The rotating vinyl label restores artist, title and year/genre in self-hosted OFL Caveat handwriting. Small Manrope branding sits at 12%, the fine rule at 22%, artist at 25–44%, title at 60–83%, and year/genre at 84–92%. The central 44–60% band stays clear of writing around the spindle. Long artist/title strings reduce in size and clamp to two lines; full metadata remains in the side display and title attributes. Local glide and braking affect visual rotation continuously. Reduced motion stops strobe/label rotation and removes vinyl sway while time, arm position and engine state remain functional. The separate light layer changes opacity from .42 at rest to .9 while playing.

The strobe uses a 1200-by-1200 canvas centred at (600,600), with four dot rows at radii 583, 571, 559 and 547. The background is `#202020`; dots are `#dedede`, with the third row white. Its square coordinate space and circular container preserve an exact circle.

The matrix shows source, elapsed time, current local RPM or stream speed, and motor state. Only analysed local audio produces a waveform; streaming shows a progress line. Its accessible image description updates with the same real data. Jog-play, physical start/stop and conventional transport agree.

### Supplied material layers

The five shipping images are `assets/turntable/chassis.png`, `vinyl.png`, `tonearm-moving.png`, `tempo-slider.png` and `lights.png`. They were supplied by the user and keep embedded origin metadata. The cleaned chassis includes the fixed bearing and empty tempo track; full-deck SVG overlays retain the supplied moving arm and tempo-thumb pixels. The moving arm keeps its exact alpha edges and eight-source-pixel upward alignment. The vinyl image uses only its gentle playing-state sway. The earlier platter and original arm/gimbal images remain with their provenance in `.impeccable/references/`, outside shipping assets. Research material stays ignored; remote crate thumbnails still come from validated YouTube IDs.

### Playback and working controls

Transport play is a dark 48px circle, reduced to 44px on phones. Crate is a labelled disclosure containing Import, Export and Download this crate; Downloads and MIDI remain separate tools, labelled Audio and MIDI on phones. Shared hover uses pale grey; keyboard focus is a 2px neutral-grey outline with 3px offset. Global listening shortcuts suppress an incidental focused-control outline until keyboard navigation or a pointer interaction restores it; text inputs retain typing and native controls retain their navigation. Disabled buttons use 0.45 opacity. Search is white with a thin neutral stroke and group focus outline. Selects and sliders retain native behavior; active crate views use a dark lower rule.

Whole-record scan is the default, with an optional 30-second window. Learn Q1 and Learn Q2 sit beside their headings. The disclosed MPC panel shows actual connection and learning state, retaining learned CC/channel mappings. Phone Q-Link learning and previous/next targets are at least 44px. Opening Downloads or MIDI brings its panel into view; closing Downloads restores the previous page position. Native disclosures and explicit recovery regions retain their own Space/Enter behavior. Moment Undo returns keyboard focus to the restored timestamp. Space toggles and R draws another record from the filtered crate outside typing fields; native range arrows remain native.

Local audio exposes continuous linked pitch/tempo, physical 33/45 controls and Quick, Natural or Heavy motor response. Natural is default. YouTube exposes supported stepped speeds through both its native speed select and the physical fader. The 33/45 record-speed controls and local motor feel remain unavailable in stream mode. Capability text remains beside the controls.

Record speed is a visible, separate control at every layout size, with 33⅓ rpm and 45 rpm options. It shares speed selection, value and local-source/loading state with the physical buttons. Scan, Pitch/Speed, Record speed and Motor feel remain distinct. Stream fader arrow keys step through supported rates; continuous coupled pitch and motor response remain local-audio capabilities. The cue target retains its accessible label and keyboard focus behavior.

### MIDI pad learning

Hardware setup is a separate full-width white working surface, up to 1120px, with connection/Q-Link controls on the left and a four-column MPC pad diagram on the right. On phones the order is connection, pad diagram, then Q-Links. Pad 13 is upper-left and Pad 1 lower-left. Pad targets are at least 104px tall (108px on phones), showing a number, action and learned channel/note or CC. Learning uses a neutral outline; live press feedback inverts graphite and white. Normal panel buttons are at least 44px tall.

Learn all 16 guides the user in numeric order; the current pad is outlined. Pads 13 and 14 explicitly wait for the matching release. Individual pads can be relearned. Complete replacement is committed only after all 16; cancellation preserves the prior profile. Incoming MIDI does not audition while learning. Notes and on/off CC controls are supported, and duplicates/Q-Link conflicts are explained. Profiles are stored by MIDI input name. Enable pad audio unlocks the browser without starting a record. Streaming latency is explicitly distinguished from direct local playback. Closing either setup control exits learning.

### Record jumps

A labelled ten-button group follows the kept-moment strip on narrow layouts only. It is absent on desktop, where keyboard 0–9 and learned MPC pads provide direct seeking. Narrow layouts use 44px minimum target heights and 6px gaps; phones show two rows of five. Thin neutral borders and tabular digits keep the controls quiet. Its helper states that 0 returns to the beginning and 1–9 jump to 10–90% of the record. Matching unmodified digit shortcuts retain typing in search and other editable fields. Buttons and shortcuts are unavailable while source loading or without a duration. Jumps preserve playing/stopped intent, including a pending motor stop.

### Track identity and current cover

The deck has no heading above it. Title, artist and known year/genre appear once under the side-display play control, replacing the decorative speaker on desktop. At 850px and below, the same identity node moves below the turntable for readable 24/14/13px text; the round decorative speaker remains in the physical sidecar. Title and artist can wrap; long text is clamped with full content retained as native tooltips and accessible text.

A single current cover leads the crate filters without a Your crate heading, Random button or duplicate metadata. It is centered within the sidebar content, up to 248px wide on desktop, with 14px rounded corners and a soft offset shadow; phone centers a 180px cover with 12px corners. A 44px-high white Add to crate button overlays its bottom edge; the supplied red crate icon and In My Crate label indicate saved membership. Clicking again removes membership without moving focus or interrupting playback. Playback state remains accessible. Search and genre/year filters follow. Keyboard R retains random selection.

### Crate sleeves and moments

Cropped square YouTube thumbnails are source images, not verified album covers. Two-line titles and metadata sit beneath. Selection uses a neutral 2px outline with 2px offset and an On the deck badge; completed local downloads receive a Downloaded badge. Hover restores image saturation without moving the sleeve. Saved moments are pale-grey timestamp chips directly below transport, with a separate remove action and Undo. Desktop moment targets are at least 36px; phone moment and remove targets are at least 44px. Empty and unavailable-image states remain textual.

### Sleeve options and source recovery

Clicking a sleeve explicitly starts its record. A separate 44px options target overlays the artwork at its upper right, with three authored white SVG dots on a smaller dark circle; it opens a viewport-positioned white menu with YouTube and Pawn actions and concise Pawn help. The menu supports Escape, arrow navigation, Home/End and focus return. Pawn removes only crate membership, keeps downloaded audio and saved moments, and presents an Undo action that restores the record.

The current-record plate reports actual Loading record, Now playing, On the deck or Could not load state. Its image is a YouTube source thumbnail fetched from the imported video ID, never bundled album-cover art. A failed image falls back to the existing neutral disc graphic.

Problem badges distinguish unavailable YouTube code 100, embedding-blocked codes 101/150 (YouTube only), generic download failures (Download needs attention), autoplay requiring YouTube Play, and unknown playback issues. HTTP 403 or an unspecified download failure does not by itself mark a recording unavailable. Stream issues persist with the crate; failed download reasons persist with the queue. Recovery exposes Retry record and Open YouTube, and successful playback clears the relevant stream warning. A completed local download remains usable even when the stream is blocked.

### Downloads and source identity

Download audio acts on the selected record; Download this crate acts on currently filtered records and changes its label to the shown count. The white queue panel opens on Needs attention when failures exist, otherwise In progress or All. Four counted filters expose Needs attention, In progress, Downloaded and All. Visible jobs sort active work before queued, failed, cancelled and completed rows. Failed jobs show a plain-language explanation, Retry and Open YouTube; raw output lives behind Technical details. Cancel remains available for active/pending jobs, with Cancel pending in the footer. Completed rows show Downloaded without a dead Ready button. Explicit actions start the yt-dlp/FFmpeg FLAC queue. Completed audio persists and loads automatically on selection. The panel footer shows the full server-reported audio directory path and FLAC format. Failed-job reasons survive restart and remain available beside Retry. Attached files remain session-only and are identified separately from downloaded audio.

Audio source & shortcuts discloses the local filename or actual YouTube player and source link. Stream mode opens it; local mode defaults closed. On phones, local identity is a compact disc-and-filename row. Kept moments remain beside the listening work below transport, with a separate removal Undo.

## Do's and Don'ts

### Do:

- **Do** preserve the exact inner-deck aspect ratio and shared arm, counterweight and record geometry.
- **Do** keep strobe motion, display values and playback feedback synchronized with the actual engine.
- **Do** retain readable neutral controls, visible keyboard focus, reduced motion and 44px phone operating targets, while preserving the separate pinned 24px cue target.
- **Do** distinguish analysed local audio, streamed progress, session attachments and persistent downloaded audio.
- **Do** preserve the supplied transparent hardware PNGs, use authored controls and live canvas data above them, and retain their embedded provenance and concept credit.

### Don't:

- **Don't** restore the superseded dark-room, green-cue and red-vinyl identity.
- **Don't** extend tiny engraving, transparent panels, gradients or nested hardware groups into routine application controls.
- **Don't** simulate stream waveforms, invent MIDI mappings or report unconfirmed playback/download states.
- **Don't** let the display sidecar stretch the deck or detach the counterweight from the rotating arm group.
- **Don't** substitute reference screenshots for the supplied hardware layers; research PNGs stay ignored and blocked by the public server, while the five approved assets ship from `assets/turntable/`.

### Two-tab record browser

Below the current-source artwork, My Crate and Dig form a two-item ARIA tablist with arrow/Home/End navigation. A shared labelled tabpanel holds the active tab’s independent artist/record/channel query and Genre/Year filters. Old All/Unheard/With moments view buttons are removed. Dig has a quiet count and graphite Keep digging action with D key hint. Trays have at most ten unique records, persist their order and exhaust each matching pool before repeating. Refreshing and membership changes never call the audio engine. The supplied raster crate illustrations occupy 44px buttons at the top right of Dig sleeves: white adds, red removes, aria-pressed and accessible names communicate state independently of colour. The existing three-dot menu moves to top left in Dig. A collapsed Source disclosure identifies working YouTube channels and exposes checking progress, unresolved counts, channel-list imports and discovery-record imports. The supplied list is independent, not a verified Sample Digging export. Cached feed listings use clearly identified broad channel genre hints and title-derived years; upload dates are never release dates. Listing checks do not download media, alter My Crate or reorder a tray after its first live population.
