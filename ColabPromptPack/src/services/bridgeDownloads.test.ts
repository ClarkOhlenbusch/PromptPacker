import { expect, it } from "vitest";
import { selectBridgeDownload } from "./bridgeDownloads";

const bridge = {
  tag_name: "bridge-v0.2.0", draft: false, prerelease: false, html_url: "https://example.com/bridge",
  assets: ["mac-universal.dmg", "windows-x64-Setup.exe", "linux-x64.AppImage", "linux-arm64.AppImage"].map(name => ({ name: `PromptPack-Bridge-0.2.0-${name}`, browser_download_url: `https://example.com/${name}` })),
};

it("selects the right Bridge installer and ignores the unrelated editor's latest release", () => {
  const editor = { ...bridge, tag_name: "v1.0.3", html_url: "https://example.com/editor" };
  expect(selectBridgeDownload([editor, bridge], "MacIntel")?.url).toMatch(/mac-universal\.dmg$/);
  expect(selectBridgeDownload([editor, bridge], "Win32")?.url).toMatch(/windows-x64-Setup\.exe$/);
  expect(selectBridgeDownload([editor, bridge], "Linux x86_64")?.url).toMatch(/linux-x64\.AppImage$/);
  expect(selectBridgeDownload([editor, bridge], "Linux aarch64")?.url).toMatch(/linux-arm64\.AppImage$/);
  const packagedNames = { ...bridge, assets: [{ name: "PromptPack-Bridge-0.2.0-linux-x86_64.AppImage", browser_download_url: "https://example.com/linux-x86_64.AppImage" }] };
  expect(selectBridgeDownload([packagedNames], "Linux x86_64")?.url).toMatch(/linux-x86_64\.AppImage$/);
});

it("does not advertise a draft or an unrelated product as a Bridge download", () => {
  expect(selectBridgeDownload([{ ...bridge, tag_name: "v1.0.3" }, { ...bridge, draft: true }], "MacIntel")).toBeNull();
  expect(selectBridgeDownload([{ ...bridge, assets: [] }], "MacIntel")?.url).toBe(bridge.html_url);
});


it("offers a published preview when no stable Bridge release is available", () => {
  const preview = { ...bridge, prerelease: true };
  expect(selectBridgeDownload([preview], "MacIntel")).toMatchObject({ isPreview: true, url: "https://example.com/mac-universal.dmg" });
  expect(selectBridgeDownload([preview, bridge], "MacIntel")?.isPreview).toBe(false);
});
