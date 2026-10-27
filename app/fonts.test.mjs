import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("default monospace font is bundled and loaded without Google Fonts", async () => {
  const layout = await readFile(new URL("./layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /import localFont from "next\/font\/local"/);
  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.match(layout, /src: "\.\/fonts\/NotoSansMono-Variable\.ttf"/);
  assert.match(layout, /weight: "100 900"/);
  assert.match(layout, /variable: "--font-noto-mono"/);
  const font = await readFile(new URL("./fonts/NotoSansMono-Variable.ttf", import.meta.url));
  assert.equal(createHash("sha256").update(font).digest("hex"), "2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081");
  const license = await readFile(new URL("./fonts/OFL.txt", import.meta.url), "utf8");
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
});
