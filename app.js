pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

const { jsPDF } = window.jspdf;

const el = {
  dropzone: document.getElementById("dropzone"),
  input: document.getElementById("fileInput"),
  selectBtn: document.getElementById("selectBtn"),
  status: document.getElementById("status"),
  infoTitle: document.getElementById("infoTitle"),
  infoFiles: document.getElementById("infoFiles"),
  infoAlgo: document.getElementById("infoAlgo"),
  message: document.getElementById("message"),
  bar: document.getElementById("progressBar"),
  resultsBox: document.getElementById("results"),
  resultList: document.getElementById("resultList"),
  zipBtn: document.getElementById("zipBtn"),
  againBtn: document.getElementById("againBtn"),
};

let zipUrl = null;

const fmtSize = (b) =>
  b < 1024
    ? `${b} B`
    : b < 1048576
    ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1048576).toFixed(1)} MB`;
const setProgress = (v) => {
  el.bar.style.width = `${v}%`;
  const bar = el.status.querySelector(".progress-wrap");
  bar?.setAttribute("aria-valuenow", String(v));
};
const setBusy = (busy) =>
  el.status.setAttribute("aria-busy", busy ? "true" : "false");
const setMsg = (t) => (el.message.textContent = t);

function resetUI() {
  if (zipUrl) {
    URL.revokeObjectURL(zipUrl);
    zipUrl = null;
  }
  el.status.classList.add("hidden");
  el.resultsBox.classList.add("hidden");
  el.resultList.innerHTML = "";
  el.zipBtn.href = "#";
  el.zipBtn.removeAttribute("download");
  el.infoTitle.textContent = "–";
  el.infoFiles.textContent = "–";
  el.infoAlgo.textContent = "–";
  setMsg("");
  setProgress(0);
  setBusy(false);
}

function autoParams(widthPt, heightPt) {
  const memGB = Number(navigator.deviceMemory || 4);
  const DPI_TARGET = 200,
    DPI_MIN = 130;
  const maxMP = memGB >= 8 ? 16 : memGB >= 6 ? 12 : memGB >= 4 ? 9 : 6;
  const MAX_PIXELS = maxMP * 1_000_000;
  const denom = (widthPt * heightPt) / (72 * 72) || 1;
  const dpiCap = Math.floor(Math.sqrt(MAX_PIXELS / denom));
  const dpi = Math.max(DPI_MIN, Math.min(DPI_TARGET, dpiCap));
  const quality = memGB < 4 ? 0.86 : memGB < 6 ? 0.88 : 0.9;
  return { dpi, quality };
}

el.selectBtn.addEventListener("click", () => el.input.click());
el.input.addEventListener("change", (e) => handleFiles(e.target.files));

["dragenter", "dragover"].forEach((type) =>
  el.dropzone.addEventListener(type, (ev) => {
    ev.preventDefault();
    el.dropzone.classList.add("hover");
  })
);
["dragleave", "drop"].forEach((type) =>
  el.dropzone.addEventListener(type, (ev) => {
    ev.preventDefault();
    el.dropzone.classList.remove("hover");
  })
);
el.dropzone.addEventListener("drop", (ev) =>
  handleFiles(ev.dataTransfer.files)
);
el.dropzone.addEventListener("click", () => el.input.click());
el.dropzone.addEventListener("keypress", (e) => {
  if (["Enter", " "].includes(e.key)) el.input.click();
});

el.againBtn.addEventListener("click", resetUI);

// ---------- Fluxo ----------
function handleFiles(files) {
  const list = Array.from(files).filter(
    (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")
  );
  if (!list.length) return alert("Selecione arquivos PDF.");
  convertBatch(list).catch((err) => {
    console.error(err);
    setMsg(`Erro: ${err?.message || err}`);
    setBusy(false);
  });
}

async function convertBatch(files) {
  resetUI();
  el.status.classList.remove("hidden");
  setBusy(true);

  el.infoTitle.textContent = `${files.length} arquivo(s) selecionado(s)`;
  el.infoFiles.textContent =
    files
      .map((f) => f.name)
      .slice(0, 3)
      .join(", ") + (files.length > 3 ? "…" : "");
  setProgress(3);
  setMsg("Lendo PDFs…");

  const meta = await Promise.all(files.map(readMeta));
  const totalPages = meta.reduce((s, m) => s + (m.pages || 0), 0) || 1;
  const sample = meta.find((m) => m.auto);
  el.infoAlgo.textContent = sample
    ? `Automático (~${sample.auto.dpi} DPI, JPEG ${Math.round(
        sample.auto.quality * 100
      )}%, RGB)`
    : "Automático (padrões)";

  el.resultsBox.classList.remove("hidden");
  const zip = new JSZip();
  let donePages = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i],
      m = meta[i];
    try {
      const result = await convertOne(f, m.auto, () => {
        donePages++;
        const pct = Math.min(
          97,
          Math.max(5, Math.round((donePages / totalPages) * 100))
        );
        setProgress(pct);
        setMsg(`Convertendo (${donePages}/${totalPages} pág)…`);
      });
      addResultItem(
        result.name,
        result.blob,
        `${result.pages} pág • ${fmtSize(result.blob.size)}`
      );
      zip.file(result.name, await result.blob.arrayBuffer());
    } catch (e) {
      console.error(e);
      addResultItem(f.name, null, "Falha na conversão");
    }
  }

  setMsg("Empacotando ZIP…");
  setProgress(98);
  const zipBlob = await zip.generateAsync({ type: "blob" });
  zipUrl = URL.createObjectURL(zipBlob);
  el.zipBtn.href = zipUrl;
  el.zipBtn.download = "convertidos.zip";
  setProgress(100);
  setMsg("Concluído!");
  setBusy(false);
}

// ---------- Metadados ----------
async function readMeta(file) {
  try {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const p1 = await pdf.getPage(1);
    const v1 = p1.getViewport({ scale: 1 });
    const auto = autoParams(v1.width, v1.height);
    const pages = pdf.numPages;
    try {
      await p1.cleanup();
    } catch {}
    try {
      await pdf.destroy();
    } catch {}
    return { pages, auto };
  } catch {
    return { pages: 0, auto: null };
  }
}

// ---------- Conversão ----------
async function convertOne(file, autoHint, onPage) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

  const first = await pdf.getPage(1);
  const v1 = first.getViewport({ scale: 1 });
  const auto = autoHint || autoParams(v1.width, v1.height);

  const out = new jsPDF({ unit: "pt", compress: true });

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const v = page.getViewport({ scale: 1 });
    const ptW = v.width,
      ptH = v.height;

    const pxW = Math.max(1, Math.round((ptW / 72) * auto.dpi));
    const pxH = Math.max(1, Math.round((ptH / 72) * auto.dpi));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: false });
    canvas.width = pxW;
    canvas.height = pxH;

    const viewport = page.getViewport({ scale: pxW / v.width });
    await page.render({ canvasContext: ctx, viewport }).promise;

    const img = canvas.toDataURL("image/jpeg", auto.quality);

    if (n === 1) {
      out.setPage(1);
      out.deletePage(1);
    }
    out.addPage([ptW, ptH]);
    out.addImage(img, "JPEG", 0, 0, ptW, ptH);

    canvas.width = canvas.height = 0;
    onPage?.();
    await Promise.resolve();
  }

  const blob = out.output("blob");
  const name = file.name.replace(/\.pdf$/i, "") + "_IMAGENS.pdf";

  try {
    await first.cleanup();
  } catch {}
  try {
    await pdf.destroy();
  } catch {}

  return { name, blob, pages: out.internal.getNumberOfPages() };
}

function addResultItem(name, blobOrNull, metaText) {
  const li = document.createElement("li");
  const left = document.createElement("div");
  left.className = "left";

  const title = document.createElement("strong");
  title.textContent = name;
  const meta = document.createElement("small");
  meta.textContent = metaText || "—";
  left.append(title, meta);
  li.append(left);

  if (blobOrNull) {
    const url = URL.createObjectURL(blobOrNull);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.className = "btn";
    a.textContent = "Baixar";
    li.append(a);
  } else {
    const fail = document.createElement("span");
    fail.className = "muted";
    fail.textContent = "Falha";
    li.append(fail);
  }
  el.resultList.append(li);
}
