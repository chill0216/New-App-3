# Face Sculpt

A mobile web app that turns the front camera into a live mirror and lets you reshape
your face with sliders. Everything runs in the browser; no video leaves the phone.

## What it does

- **Live mirror.** Allow camera access and your face appears on screen, mirrored.
- **Sixteen feature sliders** in four tabs: jaw (jaw angle, jaw width, chin projection,
  chin height), eyes (canthal tilt, eye size, eye spacing, brow ridge), midface
  (cheekbones, cheek hollow, lip fullness, philtrum length) and nose (nose bridge,
  nose width, tip projection, tip upturn). Drag one and the face changes in real time.
- **Body fat slider** that thins or fills the whole face at once.
- **Hold: original.** Press and hold to snap back to the unedited face; release to
  see the change again.
- **Front / Side toggle.** Projection-type changes (chin, brow ridge, nose bridge, nose
  tip) barely register head-on. Switch to Side, turn your head about 45°, and they
  come through. A small bar shows how far you have turned.
- **Shutter.** Tap it to get a before/after image you can save or share.

## Run it

The app is static HTML/JS. Camera access requires a secure context, so serve it over
HTTPS or on `localhost`:

```sh
npx http-server . -p 8080
# then open http://localhost:8080 on the same machine
```

To try it on a phone, deploy the folder to any static host (GitHub Pages, Netlify,
Vercel, an S3 bucket behind HTTPS) and open the URL in Safari or Chrome.

## How it works

- [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
  (loaded from jsDelivr, model from Google's storage bucket) tracks 478 landmarks and
  the head pose every frame.
- `js/mesh-data.js` holds the face-mesh triangulation (852 triangles) derived from the
  landmarker's tessellation, plus the boundary loops for the mouth and eyes.
- `js/deformations.js` defines each slider as a set of landmark handles with a direction
  in the face's own frame (lateral, up, forward). Nearby landmarks follow the handles
  with a Gaussian falloff. "Forward" handles are projected through the detected head
  pose, which is why they show up only when the head is turned.
- `js/renderer.js` draws the camera frame with WebGL, then redraws the face as a
  textured mesh whose texture coordinates are the tracked landmarks and whose
  positions are the displaced landmarks. A fixed ring around the face oval keeps the
  warp continuous with the background.
- `js/capture.js` composes the before/after image and handles save/share
  (Web Share API with a download fallback).

To self-host the MediaPipe runtime and model instead of using the CDN, define
`window.FACE_SCULPT_ASSETS = { bundle, wasm, model }` with your own URLs before
`js/app.js` loads (see the bottom of `index.html` for where it goes).

## Development

```sh
npm install          # installs Playwright for the smoke test
npm test             # runs the headless pipeline test against a sample portrait
```

The smoke test serves the repo locally, feeds a still portrait through the same
tracking and warp code the app uses, and checks that the deformation output is sane.
It needs network access to fetch the MediaPipe runtime and model.
