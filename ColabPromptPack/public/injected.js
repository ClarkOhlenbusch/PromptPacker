// PromptPack: Injected Script to access Colab Internals
(function() {
  console.log("PromptPack: Injected script running in page context.");

  window.addEventListener("message", (event) => {
    if (event.data.type !== "PROMPTPACK_REQUEST_CELLS") return;

    try {
      const cells = extractCellsFromMemory();
      window.postMessage({ 
        type: "PROMPTPACK_RESPONSE_CELLS", 
        cells: cells 
      }, "*");
    } catch (e) {
      console.error("PromptPack Extraction Error:", e);
      window.postMessage({ 
        type: "PROMPTPACK_RESPONSE_ERROR", 
        error: e.message 
      }, "*");
    }
  });

  function extractCellsFromMemory() {
    const results = [];
    
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      
      // Filter for valid notebook cells
      const validModels = models.filter(model => {
        const lang = model.getLanguageId();
        const content = model.getValue();
        
        // 1. Must be a code-like language
        const isCode = lang.includes('python') || lang === 'r' || lang === 'scala' || lang === 'sql';
        if (!isCode) return false;

        // 2. Exclude the "Master Script"
        // The master script contains all cells concatenated with # %% markers.
        // We want individual cells only to avoid massive duplication.
        const isMasterScript = content.includes('# %%') || content.includes('get_ipython()');
        if (isMasterScript) {
            console.log("PromptPack: Skipping master notebook model (ID: " + model.id + ")");
            return false;
        }

        // 3. Basic sanity checks
        if (model.getValueLength() === 0) return false;
        if (model.uri.scheme !== 'inmemory') return false;
        
        return true;
      });

      // Sort by creation ID (proxy for cell order)
      const sortedModels = validModels.sort((a, b) => {
        const getLastNum = (uri) => {
            const parts = uri.path.split('/');
            const last = parts.pop();
            return parseInt(last) || 0;
        };
        return getLastNum(a.uri) - getLastNum(b.uri);
      });

      sortedModels.forEach((model, index) => {
        const content = model.getValue();
        results.push({
          path: `cell_${index}`,
          relative_path: `Cell ${index + 1}`,
          is_dir: false,
          size: content.length,
          line_count: model.getLineCount(),
          content: content
        });
      });
      
      return results;
    }

    return [];
  }
})();
