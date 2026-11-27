(() => {
  "use strict";
  const extension = globalThis.chrome?.runtime;
  const preview = Boolean(extension?.id && extension.getManifest);
  const courseOrigin = preview ? new URL(extension.getManifest().content_scripts[0].matches[0]).origin : location.origin;
  const courseTab = window === window.top;
  if (courseTab && (!preview || location.origin !== courseOrigin || !location.pathname.includes("/mycourse/"))) return;
  const ancestors = location.ancestorOrigins;
  const topOrigin = ancestors[ancestors.length - 1];
  if (topOrigin && topOrigin !== "null" && topOrigin !== courseOrigin) return;
  if (preview) {
    // Registration and a live grant may both reach the same isolated document.
    if (globalThis.__ucasPdfReaderInstalled) return;
    globalThis.__ucasPdfReaderInstalled = true;
    if (!courseTab) extension.onMessage.addListener((message) => {
      if (message?.type === "pdf-identify-reader") {
        window.top.postMessage({ type: "ucas-selected-reader", token: message.token }, courseOrigin);
      }
    });
  }
  const modulePage = !preview && location.pathname === "/ananas/modules/pdf/index.html";
  const surfaceIds = new WeakMap();

  function readerStep(doc, command) {
    if (doc.contentType === "application/pdf" || doc.querySelector('embed[type="application/pdf"],object[type="application/pdf"]')) return "native";
    const win = doc.defaultView;
    const hits = [[0.54, 0.46], [0.72, 0.32], [0.66, 0.67]].map(([x, y]) =>
      doc.elementFromPoint(win.innerWidth * x, win.innerHeight * y));
    // A preview shell can have its own small scrollbar around the actual document frame.
    const frames = [...doc.querySelectorAll("iframe,frame")].filter((frame) => {
      const r = frame.getBoundingClientRect();
      return r.width && r.height && (hits.includes(frame) ||
        (r.width >= win.innerWidth * 0.55 && r.height >= win.innerHeight * 0.4));
    });
    if (frames.length > 1) return "ambiguous";
    if (frames.length) {
      for (let i = 0; i < win.length; i++) if (win[i] === frames[0].contentWindow) return { child: i };
      return "loading";
    }

    const page = doc.querySelector(".pdfViewer .page,.fileBox li,[data-page-number],#viewerContainer");
    let box;
    for (const hit of [page, ...hits]) {
      for (let el = hit; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
        if (el.clientHeight && el.scrollHeight > el.clientHeight + 1 &&
            /^(auto|scroll|overlay)$/.test(win.getComputedStyle(el).overflowY)) { box = el; break; }
      }
      if (box) break;
    }
    if (!box) {
      const root = doc.scrollingElement;
      if (root?.clientHeight && root.scrollHeight > root.clientHeight + 1 &&
          (page || doc.querySelector("img,canvas,svg") || root.scrollHeight - root.clientHeight > win.innerHeight * 0.25)) box = root;
    }
    if (!box) return "loading";
    if (command.probe) return "ready";
    const bottom = box.scrollHeight - box.clientHeight;
    if (box.scrollTop >= bottom - 1) {
      if (!surfaceIds.has(box)) surfaceIds.set(box, crypto.randomUUID());
      return { status: "bottom", surface: surfaceIds.get(box), extent: bottom };
    }
    if (command.speed === "0") return "manual";
    const before = box.scrollTop;
    const offset = command.speed === "end" ? bottom : before + Number(command.speed) / 2;
    box.scrollTo({ top: offset, behavior: "instant" });
    return box.scrollTop > before ? "scrolling" : "stalled";
  }

  function askPreview(win, command) {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      function finish(value) { clearTimeout(timer); channel.port1.close(); resolve(value); }
      const timer = setTimeout(() => finish("no-access"), 450);
      channel.port1.onmessage = (event) => finish(event.data);
      try {
        win.postMessage({ type: "ucas-pdf-preview-scroll", speed: command.speed, probe: command.probe === true },
          "*", [channel.port2]);
      } catch { channel.port2.close(); finish("no-access"); }
    });
  }

  function inspect(win, command) {
    let doc;
    try { doc = win.document; } catch (error) {
      if (error.name !== "SecurityError") throw error;
    }
    return doc ? readerStep(doc, command) : askPreview(win, command);
  }

  async function readFrame(win, command, active = () => document.visibilityState === "visible") {
    for (let depth = 0; win && depth < 12; depth++) {
      if (!active()) return "loading";
      const result = await inspect(win, command);
      if (Number.isInteger(result?.child) && result.child >= 0 && result.child < win.length) {
        win = win[result.child];
        continue;
      }
      if (result !== "no-access" || !win.length) return result;
      // The right-clicked and approved reader can be below an unapproved intermediate frame.
      const descendants = [];
      const queue = [win];
      for (let i = 0; i < queue.length && descendants.length < 32; i++) {
        for (let n = 0; n < queue[i].length && descendants.length < 32; n++) {
          const child = queue[i][n];
          descendants.push(child);
          queue.push(child);
        }
      }
      const states = await Promise.all(descendants.map((child) => inspect(child, { ...command, probe: true })));
      const readers = descendants.filter((_, i) => states[i] === "ready");
      if (readers.length > 1) return "ambiguous";
      if (!readers.length) return states.includes("native") ? "native" : (states.includes("loading") ? "loading" : "no-access");
      win = readers[0];
    }
    return "loading";
  }

  if (courseTab) {
    // Shared only with assistant.js in this extension's isolated world.
    globalThis.__ucasReadPdfFrame = readFrame;
    return;
  }

  window.addEventListener("message", async (event) => {
    const command = event.data;
    const port = event.ports[0];
    if (!port || event.origin !== courseOrigin || !["0", "36", "72", "108", "end"].includes(command?.speed)) return;
    if (preview) {
      if (command.type !== "ucas-pdf-preview-scroll") return;
      let ancestor = window.parent;
      while (ancestor !== event.source && ancestor !== window.top) ancestor = ancestor.parent;
      if (ancestor !== event.source) return;
    } else if (command.type !== "ucas-scroll-current-pdf" || event.source !== window.top) return;
    function reply(status) { port.postMessage(status); port.close(); }
    try {
      if (document.visibilityState !== "visible") return reply("loading");
      if (preview) return reply(readerStep(document, command));
      if (modulePage && window.frameElement?.parentElement?.classList.contains("ans-job-finished")) return reply("course-card-complete");
      const frame = modulePage && document.querySelector("iframe#panView");
      if (modulePage && !frame?.getClientRects().length) return reply("loading");
      const status = await readFrame(frame ? frame.contentWindow : window, command);
      reply(status === "course-card-complete" ? "stalled" : status);
    } catch { reply("stalled"); }
  });
})();
