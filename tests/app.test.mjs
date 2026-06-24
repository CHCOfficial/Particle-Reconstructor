import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  app: path.join(root, "app.js"),
  html: path.join(root, "index.html"),
  css: path.join(root, "styles.css"),
  license: path.join(root, "LICENSE.md"),
};

const expectedDefaults = [
  { value: "demo", label: "Generated demo image", asset: null },
  { value: "gold", label: "Gold portrait", asset: "assets/default-images/gold-portrait.png" },
  { value: "fox", label: "Iridescent fox", asset: "assets/default-images/iridescent-fox.png" },
  { value: "halo", label: "Halo world", asset: "assets/default-images/halo-world.jpeg" },
  { value: "nebula", label: "Space nebula", asset: "assets/default-images/space-nebula.png" },
  { value: "knight", label: "Rainbow knight", asset: "assets/default-images/rainbow-knight.png" },
];

async function readText(file) {
  return readFile(file, "utf8");
}

function optionValues(html, selectId) {
  const selectMatch = html.match(new RegExp(`<select id="${selectId}">([\\s\\S]*?)<\\/select>`));
  assert.ok(selectMatch, `Missing select #${selectId}`);
  return [...selectMatch[1].matchAll(/<option\s+value="([^"]+)"([^>]*)>([^<]+)<\/option>/g)].map(
    ([, value, attributes, label]) => ({
      value,
      label: label.trim(),
      selected: attributes.includes("selected"),
      hidden: attributes.includes("hidden"),
    }),
  );
}

function cssRule(css, selector) {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([\\s\\S]*?)\\}`));
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

test("JavaScript parses without syntax errors", () => {
  execFileSync(process.execPath, ["--check", files.app], { cwd: root, stdio: "pipe" });
});

test("core project files exist", async () => {
  for (const file of Object.values(files)) {
    const details = await stat(file);
    assert.ok(details.isFile(), `${file} should be a file`);
    assert.ok(details.size > 0, `${file} should not be empty`);
  }
});

test("Thread art is the default mode and removed modes are absent", async () => {
  const html = await readText(files.html);
  const app = await readText(files.app);
  const modes = optionValues(html, "modeSelect");
  const selected = modes.find((mode) => mode.selected);
  assert.deepEqual(selected, { value: "1", label: "Thread art", selected: true, hidden: false });

  const labels = modes.map((mode) => mode.label);
  assert.deepEqual(labels, [
    "Pointillist reconstruction",
    "Thread art",
    "Ink diffusion",
    "Swarming agents",
    "Vortex loom",
    "Magnetic filings",
    "Cellular growth",
  ]);

  for (const removedMode of ["Gravity wells", "Sand simulation", "Spotlight reveal"]) {
    assert.equal(html.includes(removedMode), false, `${removedMode} should not be in HTML`);
    assert.equal(app.includes(removedMode), false, `${removedMode} should not be in app metadata`);
  }
});

test("default image menu exposes all bundled artwork choices", async () => {
  const html = await readText(files.html);
  const options = optionValues(html, "defaultImageSelect");
  const visibleOptions = options.filter((option) => !option.hidden);
  assert.deepEqual(
    visibleOptions.map(({ value, label }) => ({ value, label })),
    expectedDefaults.map(({ value, label }) => ({ value, label })),
  );
  assert.equal(options.find((option) => option.value === "fox")?.selected, true);
  assert.equal(options.find((option) => option.value === "demo")?.selected, false);
  assert.equal(options.find((option) => option.value === "custom")?.hidden, true);
});

test("Iridescent fox and 500K particles are the launch defaults", async () => {
  const html = await readText(files.html);
  const app = await readText(files.app);
  assert.match(html, /<option value="fox" selected>Iridescent fox<\/option>/);
  assert.match(html, /<input id="particleCount"[^>]*value="500000"/);
  assert.ok(html.includes('<output id="particleOutput">500K</output>'));
  assert.ok(app.includes("loadDefaultImage(defaultImageSelect.value);"));
});

test("default image registry matches the selector and asset paths", async () => {
  const app = await readText(files.app);
  for (const preset of expectedDefaults) {
    assert.match(app, new RegExp(`${preset.value}: \\{ label: "${preset.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
    if (preset.asset) {
      assert.ok(app.includes(`"./${preset.asset}"`), `${preset.asset} should be registered`);
    }
  }
});

test("bundled default images exist and have expected file signatures", async () => {
  for (const preset of expectedDefaults.filter((entry) => entry.asset)) {
    const assetPath = path.join(root, preset.asset);
    const details = await stat(assetPath);
    assert.ok(details.size > 100_000, `${preset.asset} should contain image data`);
    const header = await readFile(assetPath, { length: 12 });
    const bytes = [...header.subarray(0, 12)];
    if (preset.asset.endsWith(".png")) {
      assert.deepEqual(bytes.slice(0, 8), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    } else if (preset.asset.endsWith(".jpeg")) {
      assert.deepEqual(bytes.slice(0, 3), [0xff, 0xd8, 0xff]);
    }
  }
});

test("CHCOfficial signature canvas is present, accessible, and fixed to the top right", async () => {
  const html = await readText(files.html);
  const css = await readText(files.css);
  const brandRule = cssRule(css, ".brand-particles");
  assert.ok(html.includes('id="brandCanvas"'));
  assert.ok(html.includes('aria-label="CHCOfficial particle signature"'));
  assert.match(brandRule, /position:\s*absolute;/);
  assert.match(brandRule, /top:\s*16px;/);
  assert.match(brandRule, /right:\s*16px;/);
  assert.match(brandRule, /pointer-events:\s*none;/);
  assert.match(brandRule, /width:\s*min\(180px,/);
  assert.match(brandRule, /height:\s*42px;/);
  assert.equal(brandRule.includes("background"), false);
  assert.equal(brandRule.includes("border"), false);
  assert.equal(brandRule.includes("backdrop-filter"), false);
});

test("CHCOfficial signature renderer uses compact iridescent particle colors", async () => {
  const app = await readText(files.app);
  assert.ok(app.includes('const text = "CHCOfficial";'));
  assert.ok(app.includes("ctx.globalCompositeOperation = \"lighter\";"));
  assert.ok(app.includes("[137, 241, 255]"));
  assert.ok(app.includes("[177, 151, 255]"));
  assert.ok(app.includes("[255, 124, 202]"));
  assert.ok(app.includes("ctx.fillStyle = `${particle.color}${0.2 + pulse * 0.1})`;"));
  assert.ok(app.includes("ctx.fillStyle = `${particle.color}${0.82 + pulse * 0.18})`;"));
  assert.equal(app.includes("ctx.fillStyle = `${0.62 + pulse * 0.34})`;"), false);
  assert.equal(app.includes("ctx.createLinearGradient(0, 0, width, height)"), false);
});

test("CHCOfficial particles are legible without excessive draw cost", async () => {
  const app = await readText(files.app);
  assert.ok(app.includes("const BRAND_MAX_PARTICLES = 1200;"));
  assert.ok(app.includes("const BRAND_TARGET_FPS = 24;"));
  assert.ok(app.includes("Math.floor(width / 86)"), "particle sampling should remain readable");
  assert.ok(app.includes("random() > 0.12"), "particle dropout should stay moderate");
  assert.ok(app.includes("Math.max(14, Math.floor(width * 0.1))"), "signature text should stay compact");
  assert.ok(app.includes("1.15 + random() * 0.85"), "particles should stay compact");
  assert.ok(app.includes("capParticleList(particles, BRAND_MAX_PARTICLES)"));
  assert.ok(app.includes("ctx.fillRect("), "signature should use cheap square draws");
  assert.equal(app.includes("ctx.shadowBlur"), false, "signature should not use expensive shadow blur");
  assert.equal(app.includes("ctx.arc(particle.x"), false, "signature should not draw costly arcs per particle");
});

test("license preserves attribution and BuyMeACoffee retention requirement", async () => {
  const license = await readText(files.license);
  assert.ok(license.includes("https://buymeacoffee.com/chcofficial"));
  assert.ok(license.includes("Credit is given appropriately to CHC Official"));
  assert.ok(license.includes("retained in any redistributed copy"));
});
