import { BRIDGE_DOWNLOAD_URL, BRIDGE_OPEN_URL } from "../services/bridgeSetup";
import { useEffect, useState } from "react";
import { getBridgeDownload } from "../services/bridgeDownloads";

interface BridgeSetupProps {
  status: "checking" | "missing";
  checkAgain: () => void;
}

export function BridgeSetup({ status, checkAgain }: BridgeSetupProps) {
  const [download, setDownload] = useState<{ url: string; allDownloads: string; isPreview?: boolean } | null | undefined>();
  useEffect(() => {
    if (status !== "missing") return;
    const controller = new AbortController();
    getBridgeDownload(navigator.platform, controller.signal).then(setDownload).catch(() => {
      if (!controller.signal.aborted) setDownload({ url: BRIDGE_DOWNLOAD_URL, allDownloads: BRIDGE_DOWNLOAD_URL });
    });
    return () => controller.abort();
  }, [status]);
  if (status === "checking") return <p role="status" className="text-xs text-slate-500">Checking for PromptPack Bridge…</p>;
  return (
    <section aria-label="Set up PromptPack Bridge" className="rounded-lg border border-blue-100 bg-blue-50/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Get PromptPack Bridge</h3>
        <p className="text-xs text-slate-600 mt-1">Agent Terminal needs this small companion app to connect to the coding agent on your computer.</p>
      </div>
      <ol className="list-decimal pl-4 space-y-1 text-xs text-slate-600">
        <li>Download Bridge for your computer and install it.</li>
        <li>Open PromptPack Bridge and wait for “Ready for Colab.”</li>
        <li>Return here and start your session.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {download === null
          ? <span className="text-slate-600">Bridge installers haven’t been published yet.</span>
          : <a href={download?.url || BRIDGE_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" className="px-3 py-2 rounded bg-packer-blue text-white font-semibold">Download Bridge</a>}
        {download?.isPreview && <span className="text-slate-600">Preview installer; your operating system may show an unsigned app warning.</span>}
        {download && <a href={download.allDownloads} target="_blank" rel="noopener noreferrer" className="text-packer-blue underline underline-offset-2">Other computers</a>}
        {/Mac|Win/i.test(navigator.platform)
          ? <a href={BRIDGE_OPEN_URL} className="text-packer-blue underline underline-offset-2">Already installed? Open Bridge</a>
          : <span className="text-slate-600">Already downloaded? Open the Bridge app.</span>}
        <button onClick={checkAgain} className="text-slate-600 underline underline-offset-2">Check again</button>
      </div>
      <p className="text-[11px] text-slate-500">Supports macOS, Windows, and Linux. No terminal commands needed to run Bridge.</p>
    </section>
  );
}
