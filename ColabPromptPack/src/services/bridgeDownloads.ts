import { BRIDGE_DOWNLOAD_URL } from "./bridgeSetup";

interface Release {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export function selectBridgeDownload(releases: Release[], platform: string) {
  const release = releases.find(item => item.tag_name.startsWith("bridge-v") && !item.draft && !item.prerelease);
  if (!release) return null;
  const match = /mac/i.test(platform) ? /mac-universal\.dmg$/
    : /win/i.test(platform) ? /windows-x64-Setup\.exe$/
    : /arm|aarch/i.test(platform) ? /linux-(?:arm64|aarch64)\.AppImage$/ : /linux-(?:x64|x86_64)\.AppImage$/;
  const asset = release.assets.find(item => match.test(item.name));
  return { url: asset?.browser_download_url || release.html_url, allDownloads: release.html_url };
}

export async function getBridgeDownload(platform: string, signal: AbortSignal) {
  const response = await fetch("https://api.github.com/repos/ClarkOhlenbusch/PromptPacker/releases?per_page=30", { signal });
  if (!response.ok) return { url: BRIDGE_DOWNLOAD_URL, allDownloads: BRIDGE_DOWNLOAD_URL };
  return selectBridgeDownload(await response.json(), platform);
}
