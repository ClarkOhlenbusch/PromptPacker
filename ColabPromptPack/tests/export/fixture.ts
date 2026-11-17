import type { Notebook } from "../../src/utils/notebookExport";

export const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=";
export const tableHtml = `<div class="colab-df-container"><style>.dataframe thead th{text-align:right}.dataframe td{color:rgb(22,101,52);padding:8px 12px}</style><table class="dataframe"><thead><tr><th></th><th>age</th><th>income</th><th>city</th><th>education</th><th>spending_score</th></tr></thead><tbody><tr><th>0</th><td>25</td><td>50000</td><td>Boston</td><td>Bachelors</td><td>60</td></tr><tr><th>1</th><td>32</td><td>64000</td><td>NYC</td><td>Masters</td><td>70</td></tr></tbody></table><div class="colab-df-buttons"><button onclick="google.colab.convertToInteractive()"><svg onload="window.compromised=true"></svg>Convert</button><script>google.colab.convertToInteractive()</script></div></div>`;
// scikit-learn's diagram and disclosure structure. CSS, not JS, activates it.
export const pipelineHtml = `<style>/* Documentation for the <a> tag */#sk-container-id-1 .sk-text-repr-fallback{display:none}#sk-container-id-1 .sk-container{display:inline-block!important}#sk-container-id-1 .sk-toggleable__content{display:none}#sk-container-id-1 input:checked~.sk-toggleable__content{display:block}.sk-label{background:rgb(212,235,255);padding:12px}.sk-container{border:1px dashed gray;padding:12px}input{position:absolute;clip:rect(1px,1px,1px,1px)}</style><div id="sk-container-id-1"><div class="sk-text-repr-fallback">Please trust this notebook</div><div class="sk-container" hidden><div class="sk-label">Pipeline</div><input type="checkbox" id="sk-estimator-1"><label for="sk-estimator-1">StandardScaler</label><div class="sk-toggleable__content">StandardScaler(with_mean=True)</div></div></div>`;
export const exportNotebook: Notebook = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { name: "python3" }, custom: { keep: true } },
  cells: [
    { cell_type: "markdown", source: "# Assignment\n\nInline $x$ and \\(y\\).\n\n$$x^2 + y^2 = 1$$", metadata: { id: "intro" } },
    { cell_type: "code", source: "df.head()", execution_count: 1, metadata: { id: "data" }, outputs: [{ output_type: "execute_result", data: { "text/html": tableHtml, "text/plain": "   age income city\n0 25 50000 Boston" } }] },
    { cell_type: "code", source: "pipeline", outputs: [{ output_type: "execute_result", data: { "text/html": pipelineHtml, "text/plain": "Pipeline(StandardScaler())" } }] },
    { cell_type: "code", source: "plot()", outputs: [{ output_type: "display_data", data: { "image/svg+xml": '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120"><style>.bar{fill:rgb(26,115,232)}</style><defs><clipPath id="clip"><rect width="250" height="110"/></clipPath></defs><g clip-path="url(#clip)"><rect class="bar" x="10" y="10" width="90" height="90"/><text x="110" y="60">Saved chart</text></g></svg>' } }] },
    { cell_type: "code", source: "image()", outputs: [{ output_type: "display_data", metadata: { "image/png": { width: 80 } }, data: { "image/png": pixel, "application/vnd.jupyter.widget-view+json": { model_id: "alternative" } } }] },
  ],
};
