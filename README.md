# Particle Reconstructor

GPU-powered image reconstruction that turns source images into moving particle
fields, threads, ink, swarms, magnetic filings, and cellular growth patterns.

The app runs as a static browser project. Open `index.html` directly, or serve
the folder locally for the most reliable asset loading.

<img width="2246" height="1840" alt="image" src="https://github.com/user-attachments/assets/2788a57e-ca29-4593-a0fe-48bb00c4c4b1" />


## Features

- WebGL2 particle renderer with high particle counts.
- Default artwork presets, including the Iridescent fox launch image.
- Upload your own image and rebuild the particle field.
- Reconstruction modes including Thread art, Pointillist reconstruction, Ink
  diffusion, Swarming agents, Vortex loom, Magnetic filings, and Cellular growth.
- Interactive pointer forces for shaping the image reconstruction.
- Persistent `CHCOfficial` particle signature.

## Running Locally

From the project folder:

```sh
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173
```

You can also open `index.html` directly in a browser.

## Tests

```sh
npm test
```

Syntax-only check:

```sh
npm run test:syntax
```

## Credits

Created by CHC Official.

Please retain and credit the BuyMeACoffee link when reusing or redistributing
any part of this project:

https://buymeacoffee.com/chcofficial

## Licence

See `LICENCE` and `LICENSE.md`.
