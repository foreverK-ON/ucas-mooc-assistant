(() => {
  "use strict";

  const courseId = "350140000041158";
  const practiceWords = "(?:章节|单元|随堂|课后)(?:测验|测试|练习|习题|作业)";
  const unit = "第\\s*[一二三四五六七八九十百两\\d]+\\s*(?:章|节|单元)";
  const practiceTitle = new RegExp(`^(?:${unit}\\s*(?:测验|测试|练习|习题|作业)|(?:\\d+(?:[.．-]\\d+)*[.．、]?\\s*)?${practiceWords})(?:$|[\\s:：（(]|[一二三四五六七八九十\\d])`);
  const numberedPractice = new RegExp(`^\\d+(?:[.．-]\\d+)*[.．、]?\\s*.{0,72}(?:${practiceWords})$`);
  const numberedShortTitle = /^\d+(?:[.．-]\d+)+\s*(?:作业|练习题?|习题|测验)(?:\s*[一二三四五六七八九十\d]+)?$/;
  const quizTitle = /^(?:\d+(?:[.．-]\d+)+\s*)?quiz(?:\s*\d+)?(?:\s*[:：–-]\s*.+)?$/i;
  const quizName = /\bquiz(?=\b|\d)/i;
  const nextLabel = /^(?:进入)?(?:下一节|下一小节|下一课时|下一章节|下一个章节|下一(?:个)?(?:节点|知识点))[\s»›→>]*$/;
  const normalize = (text) => text.replace(/\s+/gu, " ").trim();

  function numericParam(url, ...names) {
    for (const name of url.searchParams.keys()) {
      if (!names.includes(name.toLowerCase())) continue;
      const value = url.searchParams.get(name);
      if (/^\d{1,24}$/.test(value)) return value;
    }
    return "";
  }

  function isPracticeTitle(text) {
    return text.length <= 100 && !/讲解|解析|讲评|录播/.test(text) &&
      (practiceTitle.test(text) || numberedPractice.test(text) || numberedShortTitle.test(text) || quizTitle.test(text));
  }

  function visible(element) {
    if (!element.getClientRects().length || element.closest("[hidden], [inert], [aria-hidden='true']")) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return style?.visibility === "visible" && style.opacity !== "0";
  }

  const resources = 'video, iframe, frame, object, embed';
  const videoFrameSelector = 'iframe.ans-insertvideo-online, iframe[data-type="video"], iframe[src*="/modules/video/"], iframe[data-src*="/modules/video/"]';
  const workFrameSelector = 'iframe.ans-insertwork-online, iframe[data-module="work"], iframe[src*="/ananas/modules/work/"], iframe[src*="/mooc-ans/api/work?"], iframe[_src*="/mooc-ans/api/work?"], iframe[data-src*="/ananas/modules/work/"]';
  const outsideLesson = 'aside, nav, [role="navigation"], [role="tree"], .posCatalog, [role="dialog"], dialog';

  function cardLabels(node) {
    const texts = [];
    // Only look backwards within this card. A completed video may be directly above it.
    for (let branch = node; branch && texts.length < 6; branch = branch.parentElement) {
      for (let prev = branch.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.matches(resources) || prev.querySelector(resources)) return texts;
        if (!visible(prev)) continue;
        const text = (prev.innerText || "").trim();
        if (text.length > 500) return texts;
        if (text) texts.push(...text.split("\n").map(normalize));
        for (const badge of [prev, ...prev.querySelectorAll('[aria-label="任务点已完成"],[title="任务点已完成"],[alt="任务点已完成"]')]) {
          if (visible(badge) && ["title", "aria-label", "alt"].some((attr) => badge.getAttribute(attr) === "任务点已完成")) {
            texts.push("任务点已完成");
          }
        }
        if (texts.length >= 6) return texts;
      }
      if (branch === node.ownerDocument.body) break;
    }
    return texts;
  }

  function taskMarker(node) {
    const wrapper = node.parentElement;
    const marker = wrapper?.querySelector(":scope > .ans-job-icon");
    return marker && (wrapper.matches(".ans-attach-ct") || wrapper.querySelectorAll(resources).length === 1) ? marker : null;
  }

  function cardInfo(node) {
    const type = node.getAttribute("type") || "";
    const file = (node.getAttribute("src") || node.getAttribute("data") || "").split(/[?#]/, 1)[0];
    const labels = cardLabels(node);
    let doc = node.ownerDocument;
    let markedFinished = node.parentElement?.classList.contains("ans-job-finished");
    let ownMarker = taskMarker(node);
    while (doc.defaultView.frameElement) {
      const frame = doc.defaultView.frameElement;
      if (doc.querySelectorAll(resources).length !== 1 && !(node.tagName === "VIDEO" && frame.matches(videoFrameSelector))) break;
      labels.push(...cardLabels(frame));
      markedFinished ||= frame.parentElement?.classList.contains("ans-job-finished");
      ownMarker ||= taskMarker(frame);
      doc = frame.ownerDocument;
    }
    const pdf = !node.matches(workFrameSelector) && (type.toLowerCase() === "application/pdf" || /\.pdf$|\/(?:pdf|pdfjs|pdf\.js)\//i.test(file) ||
      [node.title, node.getAttribute("aria-label"), ...labels].some((label) => /\bPDF\b/i.test(label || "")));
    if (pdf && node.contentDocument?.body) {
      const viewers = node.contentDocument.querySelectorAll('#viewerContainer, embed[type="application/pdf"], object[type="application/pdf"], iframe');
      if (viewers.length === 1) labels.unshift(...cardLabels(viewers[0]));
    }
    const status = labels.find((label) => /^(?:[√✓✔]\s*)?任务点(?:已完成|未完成)?$/.test(label));
    const complete = markedFinished === true || (ownMarker
      ? [ownMarker.innerText, ownMarker.title, ownMarker.getAttribute("aria-label")].some((s) => s?.trim() === "任务点已完成")
      : status?.endsWith("已完成") === true);
    return { pdf, status, complete };
  }

  function snapshot() {
    const documents = [];
    const players = [];
    const pdfs = new Map();
    function visit(doc) {
      documents.push(doc);
      for (const node of doc.querySelectorAll(resources)) {
        if (!visible(node)) continue;
        if (node.parentElement?.closest("object")) continue;
        if (node.tagName === "VIDEO") {
          players.push(node);
          continue;
        }
        const info = cardInfo(node);
        if (info.pdf) {
          pdfs.set(node, info);
          players.push(node);
          continue;
        }
        const videoFrame = node.matches(videoFrameSelector);
        const child = node.contentDocument;
        if (child?.body && (child.URL !== "about:blank" || child.body.childElementCount)) {
          const count = players.length;
          visit(child);
          if (players.length === count && (videoFrame || (info.status && node.clientWidth >= 120 && node.clientHeight >= 80))) players.push(node);
        } else if (videoFrame || (node.clientWidth >= 120 && node.clientHeight >= 80)) {
          // A sizeable embedded card may load only after scrolling into view.
          players.push(node);
        }
      }
    }
    visit(document);
    return { documents, players, pdfs };
  }

  function nextControl(scopes, origin, labelPattern = nextLabel, outsideQuestions = false) {
    const candidates = [];
    for (const scope of scopes) {
      const doc = scope.ownerDocument || scope;
      for (const control of scope.querySelectorAll('a, button, input[type="button"], [role="link"], [role="button"], [onclick], [tabindex]')) {
        const labels = [control.innerText, control.getAttribute("aria-label"), control.title];
        if (control.matches('input[type="button"]')) labels.push(control.value);
        if (labels.some((label) => label && labelPattern.test(normalize(label))) && visible(control)) candidates.push(control);
      }
      // Some course pages delegate clicks from a plain text label to a parent.
      for (const label of scope.querySelectorAll("span, div")) {
        if (label.childElementCount || !labelPattern.test(normalize(label.textContent || ""))) continue;
        if (candidates.some((candidate) => candidate.contains(label))) continue;
        if (visible(label) && doc.defaultView.getComputedStyle(label).cursor === "pointer") candidates.push(label);
      }
    }
    const allowed = outsideQuestions ? candidates.filter((node) => {
      if (node.closest("form")) return false;
      for (let frame = node.ownerDocument.defaultView.frameElement; frame; frame = frame.ownerDocument.defaultView.frameElement) {
        if (frame.matches(workFrameSelector)) return false;
      }
      return true;
    }) : candidates;
    const distinct = [...new Set(allowed)].filter((node) => !allowed.some((other) => other !== node && node.contains(other)));
    if (distinct.length !== 1) return null;
    const control = distinct[0].closest('a, button') || distinct[0];
    if (control.matches(":disabled") || control.closest('[aria-disabled="true"], .disabled, .locked, [inert]')) return null;
    if (control.form && control.type !== "button") return null;
    const inheritedTarget = control.ownerDocument.querySelector("base[target]")?.getAttribute("target");
    const target = (control.getAttribute("target") || inheritedTarget || "_self").toLowerCase();
    if (!["_self", "_parent", "_top"].includes(target) || control.hasAttribute("download")) return null;
    const href = control.getAttribute("href")?.trim();
    if (href && !/^javascript:\s*(?:void\s*\(\s*0\s*\))?;?\s*$/i.test(href)) {
      let destination;
      try {
        destination = new URL(href, control.ownerDocument.baseURI);
      } catch {
        return null;
      }
      if (destination.origin !== origin ||
          !(destination.pathname.startsWith("/mooc2-ans/") || destination.pathname.startsWith("/mooc-ans/mycourse/"))) return null;
      const destinationCourse = numericParam(destination, "courseid");
      if (destinationCourse && destinationCourse !== courseId) return null;
    }
    return control;
  }

  function unfinishedDialogNext(documents) {
    const prompt = /当前章节还有任务点未完成[，,。]?是否去(?:完成|学习)[?？]?/;
    for (const doc of documents) {
      // Start at the other button so the footer behind the dialog is outside our search.
      for (const label of doc.querySelectorAll("a, button, input[type=button], span, div")) {
        if (label.childElementCount || normalize(label.textContent || label.value || "") !== "去学习" || !visible(label)) continue;
        for (let box = label.parentElement; box && box !== doc.body; box = box.parentElement) {
          const text = (box.innerText || "").replace(/\s+/g, "");
          if (text.length > 120) break;
          if (!prompt.test(text)) continue;
          const next = nextControl([box], location.origin, /^下一节$/);
          if (next) return next;
        }
      }
    }
    return null;
  }

  const url = new URL(location.href);
  if (!url.pathname.includes("/mycourse/") || numericParam(url, "courseid") !== courseId) return;

  const panel = document.createElement("div");
  panel.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147483647";
  const shadow = panel.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      details { box-sizing:border-box; max-width:min(330px, calc(100vw - 32px)); background:#fff;
        color:#17202a; border:1px solid #b0b8bf; border-radius:8px; padding:9px 12px;
        box-shadow:0 2px 12px #0002; font:14px/1.5 system-ui,sans-serif; }
      summary { cursor:pointer; font-weight:650; }
      button { font:inherit; margin:3px 4px 3px 0; }
      p { margin:8px 0; }
      p:empty { display:none; }
    </style>
    <details>
      <summary>国科大在线学习助手</summary>
      <p id="playback" role="status"></p>
      <p id="pdf-access" role="status" hidden></p>
      <p id="detected"></p>
      <button type="button" id="arm">开启连续切换</button>
      <button type="button" id="stop">关闭连续切换</button>
      <button type="button" id="read">从当前 PDF 继续</button>
      <button type="button" id="finished" hidden>我已读完此 PDF，继续</button>
      <label>PDF 阅读速度
        <select id="speed">
          <option value="0">手动滚动</option>
          <option value="36">慢速</option>
          <option value="72">标准</option>
          <option value="108">快速</option>
          <option value="end">直达末页</option>
        </select>
      </label>
      <button type="button" id="export">导出旧版习题清单</button>
      <p id="message" role="status"></p>
    </details>`;
  document.body.append(panel);

  const playback = shadow.getElementById("playback");
  let readerGrant;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "pdf-access-result" || typeof message.text !== "string") return;
    const notice = shadow.getElementById("pdf-access");
    notice.textContent = message.text;
    notice.hidden = false;
    readerGrant = enabled && message.token ? { token: message.token, origin: message.origin, chapter: chapterKey() } : null;
  });
  window.addEventListener("message", (event) => {
    if (event.data?.type !== "ucas-selected-reader" || !readerGrant || event.origin !== readerGrant.origin ||
        event.data.token !== readerGrant.token || !event.source) return;
    readerGrant.source = event.source;
  });
  const message = shadow.getElementById("message");
  const modeKey = `ucas-study:auto-next:${courseId}`;
  const speed = shadow.getElementById("speed");
  const speedKey = modeKey + ":pdf-speed";
  const savedSpeed = sessionStorage.getItem(speedKey);
  speed.value = [...speed.options].some((option) => option.value === savedSpeed) ? savedSpeed : "end";
  speed.addEventListener("change", () => sessionStorage.setItem(speedKey, speed.value));
  let enabled = sessionStorage.getItem(modeKey) === "on";
  let ends = new WeakMap();
  let pending;
  let reading;
  let entryTimer;
  let entry;
  function showMode() {
    shadow.getElementById("arm").disabled = enabled;
    shadow.getElementById("stop").disabled = !enabled;
    shadow.getElementById("read").disabled = !enabled;
    playback.textContent = enabled ? "连续切换已开启，正在等待当前节点的课件。" : "连续切换已关闭。";
  }
  showMode();

  function chapterHeading(doc) {
    const chapter = numericParam(new URL(doc.URL), "chapterid", "knowledgeid", "nodeid");
    const row = chapter && (doc.getElementById("cur" + chapter) || doc.getElementById("dct" + chapter) ||
      doc.querySelector(`[data-chapterid="${chapter}"], [data-knowledgeid="${chapter}"], [data-chapter-id="${chapter}"]`));
    const headings = [...doc.querySelectorAll('.posCatalog_select, .posCatalog_active, [aria-current="step"], [role="treeitem"][aria-selected="true"]'),
      row, ...doc.querySelectorAll('[aria-current="page"]'), ...Array.from(doc.querySelectorAll("h1,h2")).filter((node) => !node.closest(outsideLesson))];
    for (const heading of headings) {
      if (!heading || !visible(heading)) continue;
      const lines = (heading.innerText || "").trim().split(/\n+/);
      if (lines.length > 1 && /^\d+$/.test(lines.at(-1).trim())) lines.pop();
      const title = normalize(lines.join(" "));
      if (title && title.length <= 100 && !/^(?:[\d.．✓✔√]+|目录|章节(?:详情)?|学生学习页面|作业|测验)$/.test(title)) return { title, node: heading };
    }
    return { title: chapter ? `章节 ${chapter}` : "", node: null };
  }

  function currentChapter(doc) {
    return chapterHeading(doc).title;
  }

  function inLesson(node) {
    for (let part = node; part; part = part.ownerDocument.defaultView.frameElement) {
      if (part.closest(outsideLesson)) return false;
    }
    return visible(node);
  }

  function practiceTask({ documents, players, pdfs }, heading) {
    if (quizName.test(heading.title)) return heading;
    if (pdfs.size || players.some((node) => node.matches(`video, ${videoFrameSelector}`))) return null;
    if (isPracticeTitle(heading.title)) return heading;

    let fallback;
    for (const doc of documents) {
      const label = [...doc.querySelectorAll("h1,h2,h3,[role=heading],.chapter-title,.chapterTitle")].find((node) =>
        isPracticeTitle(normalize(node.textContent || "")) && inLesson(node));
      let marker = [...doc.querySelectorAll(workFrameSelector)].find(inLesson) || label;
      if (!marker) {
        const controls = [...doc.querySelectorAll('button,a,input[type=submit],input[type=button],[role=button],[onclick]')];
        const caption = (node) => (node.innerText || node.getAttribute("aria-label") || node.value || "").replace(/\s+/g, "");
        const submit = controls.find((node) => /^提交(?:作业|试卷|答案)?$/.test(caption(node)) && inLesson(node));
        const scope = submit?.closest("form") || doc;
        if (submit && (controls.some((node) => scope.contains(node) && caption(node) === "暂时保存" && inLesson(node)) ||
            [...scope.querySelectorAll('input[type=radio],input[type=checkbox],[role=radiogroup]')].some(inLesson))) marker = submit;
      }
      if (!marker) continue;
      // An outer course frame can stand in for the question sheet while it is loading.
      const frames = new Set([marker]);
      for (let frame = doc.defaultView.frameElement; frame; frame = frame.ownerDocument.defaultView.frameElement) frames.add(frame);
      if (players.some((node) => !frames.has(node) && !node.matches(workFrameSelector))) continue;
      if (label) return { node: marker, title: normalize(label.innerText) };
      fallback ??= { node: marker, title: heading.node ? heading.title : "章节测验" };
    }
    return fallback;
  }

  function scrollPracticeBottom(documents, marker) {
    const containers = new Set();
    for (const doc of documents) {
      if (doc.defaultView.frameElement && !inLesson(doc.defaultView.frameElement)) continue;
      containers.add(doc.scrollingElement);
      let hasPane = false;
      const scrolls = (node) => node.clientHeight > 0 && node.scrollHeight > node.clientHeight &&
        /^(auto|scroll|overlay)$/.test(doc.defaultView.getComputedStyle(node).overflowY);
      const anchors = [marker, ...doc.querySelectorAll("main,[role=main],article,footer,form,iframe,frame,input[type=submit]")];
      for (const anchor of anchors) {
        if (!anchor || anchor.ownerDocument !== doc || anchor.closest(outsideLesson)) continue;
        for (let node = anchor; node && node !== doc.scrollingElement; node = node.parentElement) {
          if (containers.has(node)) break;
          if (scrolls(node)) {
            containers.add(node);
            hasPane = true;
          }
        }
      }
      if (!hasPane) {
        // Some lesson templates use an unnamed scrollable div beside a narrow chapter directory.
        const panes = [...doc.querySelectorAll("div,section")].filter((node) =>
          node.clientWidth >= doc.documentElement.clientWidth / 2 && scrolls(node) && inLesson(node));
        panes.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
        if (panes.length) containers.add(panes[0]);
      }
    }
    for (const box of containers) {
      if (box && box.scrollHeight - box.clientHeight - box.scrollTop > 1) box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
    }
  }

  function bindButton(id, action) {
    shadow.getElementById(id).addEventListener("click", async (event) => {
      if (!event.isTrusted) return;
      try {
        await action();
      } catch {
        message.textContent = "操作未完成，请刷新课程页后重试。";
      }
    });
  }

  // Course cards may load after the page or expand inside a same-origin frame.
  const watchers = new Map();
  const interest = /测验|练习|习题|作业|测试|\bquiz\b/i;
  const taskElements = `${resources},form,input[type=radio],[role=radiogroup]`;
  let scheduled = false;
  function observeDocuments(docs) {
    for (const [doc, watcher] of watchers) {
      if (docs.includes(doc)) continue;
      watcher.observer.disconnect();
      watcher.listeners.abort();
      watchers.delete(doc);
    }
    for (const doc of docs) {
      if (watchers.has(doc)) continue;
      const observer = new MutationObserver((changes) => {
        for (const change of changes) {
          const nodes = change.type === "childList" ? change.addedNodes : [change.target];
          for (const node of nodes) {
            if (node.matches?.(taskElements) || node.querySelector?.(taskElements) || interest.test(node.textContent || "")) {
              scheduleScan();
              return;
            }
          }
        }
      });
      const listeners = new AbortController();
      const options = { capture: true, signal: listeners.signal };
      doc.addEventListener("ended", onVideoEnded, options);
      doc.addEventListener("playing", (event) => {
        if (event.isTrusted && event.target.tagName === "VIDEO") {
          ends.delete(event.target);
          cancelPending();
          stopReading();
          if (enabled) {
            const { players } = snapshot();
            const index = players.indexOf(event.target);
            if (index >= 0) {
              if (entry) entry.startup = null;
              playback.textContent = `正在播放本页第 ${index + 1} 个播放器。`;
            }
          }
        }
      }, options);
      doc.addEventListener("load", (event) => {
        if (event.target.tagName !== "IFRAME") return;
        observeDocuments(snapshot().documents);
        scheduleScan();
      }, options);
      doc.addEventListener("click", scheduleScan, options);
      doc.addEventListener("click", trackNextClick, options);
      doc.addEventListener("toggle", scheduleScan, options);
      observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ["open", "hidden", "aria-expanded", "aria-hidden"] });
      watchers.set(doc, { observer, listeners });
    }
  }

  function scheduleScan() {
    if (scheduled || document.visibilityState !== "visible") return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (document.visibilityState !== "visible" || numericParam(new URL(location.href), "courseid") !== courseId) return;
      const page = snapshot();
      const { documents: docs, players, pdfs } = page;
      observeDocuments(docs);
      // The site can replace the lesson itself without changing the outer URL or heading.
      if (enabled && entry?.started && !entry.practice && !entry.nextClick && !entry.startup &&
          !players.some((node) => entry.tasks?.get(node) === taskVersion(node)) && practiceTask(page, chapterHeading(document))) {
        cancelPending();
        stopReading();
        entry.started = false;
        entry.awaitingFooter = false;
      }
      const readable = players.filter((item) => item.tagName === "VIDEO").length;
      const unknown = players.length - readable - pdfs.size;
      shadow.getElementById("detected").textContent = `本页识别到 ${readable} 个视频、${pdfs.size} 个 PDF` +
        (unknown ? `，另有 ${unknown} 个嵌入区域待读取。` : "。");
    }, 500);
  }
  document.addEventListener("visibilitychange", scheduleScan);
  observeDocuments(snapshot().documents);
  scheduleScan();
  bindButton("export", async () => {
    const prefix = `practice:${courseId}:`;
    const all = await chrome.storage.local.get(null);
    const rows = Object.entries(all).filter(([key]) => key.startsWith(prefix)).map(([, row]) => row);
    if (!rows.length) {
      message.textContent = "没有旧版保存的习题清单。";
      return;
    }
    const lines = rows.sort((a, b) => a.title.localeCompare(b.title, "zh-CN", { numeric: true }))
      .map(({ title, place }, index) => `${index + 1}. ${title}（${place}）`);
    const downloadUrl = URL.createObjectURL(new Blob(["\uFEFF国科大在线习题清单\r\n\r\n", lines.join("\r\n")], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = "国科大在线-习题清单.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 30_000);
    message.textContent = `已请求导出 ${rows.length} 条旧版记录。`;
  });

  function cancelPending() {
    clearTimeout(pending?.timer);
    pending = undefined;
  }

  function setMode(value) {
    enabled = value;
    readerGrant = null;
    if (value) sessionStorage.setItem(modeKey, "on");
    else sessionStorage.removeItem(modeKey);
    cancelPending();
    stopReading();
    clearInterval(entryTimer);
    entry = undefined;
    ends = new WeakMap();
    showMode();
    if (value) watchEntries();
  }

  async function foreground() {
    if (document.visibilityState !== "visible") return false;
    if (document.hasFocus()) return true;
    try {
      return await chrome.runtime.sendMessage("study-tab-in-foreground") === true && document.visibilityState === "visible";
    } catch {
      return false;
    }
  }

  function chapterKey() {
    const current = new URL(location.href);
    const chapter = numericParam(current, "chapterid", "knowledgeid", "nodeid") || currentChapter(document);
    return [current.pathname, numericParam(current, "courseid"), chapter].join("|");
  }

  function hasPlayingVideo(players) {
    return players.some((item) => item.tagName === "VIDEO" && !item.paused && !item.ended);
  }

  function reveal(player) {
    const path = [player];
    for (let frame = player.ownerDocument.defaultView.frameElement; frame; frame = frame.ownerDocument.defaultView.frameElement) {
      path.unshift(frame);
    }
    for (const node of path) node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  }

  function scrollChapterTop({ documents, players }) {
    const containers = new Set();
    for (const doc of documents) {
      if (doc.scrollingElement) containers.add(doc.scrollingElement);
    }
    const anchors = [...players, ...documents.flatMap((doc) =>
      [doc.defaultView.frameElement, doc.querySelector("main, [role=main], #iframe") || doc.querySelector("h1, h2")])];
    for (const anchor of anchors) {
      for (let box = anchor; box; box = box.parentElement) {
        if (players.includes(box)) continue;
        if (box.scrollTop) containers.add(box);
      }
    }
    for (const box of containers) {
      if (box.scrollTop) box.scrollTo({ top: 0, behavior: "instant" });
    }
  }

  function visibleArea(element) {
    let { left, top, right, bottom } = element.getBoundingClientRect();
    for (let win = element.ownerDocument.defaultView; win; win = win.parent) {
      left = Math.max(0, left); top = Math.max(0, top);
      right = Math.min(right, win.innerWidth); bottom = Math.min(bottom, win.innerHeight);
      if (right <= left || bottom <= top) return 0;
      const frame = win.frameElement;
      if (!frame) break;
      const rect = frame.getBoundingClientRect();
      left += rect.left + frame.clientLeft; right += rect.left + frame.clientLeft;
      top += rect.top + frame.clientTop; bottom += rect.top + frame.clientTop;
    }
    return (right - left) * (bottom - top);
  }

  function centerControl(video) {
    const doc = video.ownerDocument;
    function hitAt(owner, px, py) {
      let hit = owner.elementFromPoint(px, py);
      if (owner === document && hit === panel) {
        panel.style.left = px < innerWidth / 2 ? "auto" : "16px";
        panel.style.right = px < innerWidth / 2 ? "16px" : "auto";
        hit = owner.elementFromPoint(px, py);
        if (hit === panel) {
          panel.style.top = py < innerHeight / 2 ? "auto" : "16px";
          panel.style.bottom = py < innerHeight / 2 ? "16px" : "auto";
          hit = owner.elementFromPoint(px, py);
        }
      }
      return hit;
    }
    function exposedCenter(element) {
      const rect = element.getBoundingClientRect();
      let x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const hit = hitAt(doc, x, y);
      if (!hit || hit.closest('[aria-modal="true"],dialog[open]')) return null;
      for (let frame = doc.defaultView.frameElement; frame; frame = frame.ownerDocument.defaultView.frameElement) {
        const box = frame.getBoundingClientRect();
        x += box.left + frame.clientLeft; y += box.top + frame.clientTop;
        if (hitAt(frame.ownerDocument, x, y) !== frame) return null;
      }
      return hit;
    }
    const hit = exposedCenter(video);
    if (!hit) return null;
    const poster = '.vjs-big-play-button, .prism-big-play-btn, .xgplayer-start';
    function isPlayButton(el) {
      const name = normalize(el.getAttribute("aria-label") || el.title || el.textContent || "");
      return (el.matches(poster) || /^(?:播放(?:视频)?|开始播放|play(?: video)?)$/i.test(name)) &&
        !el.matches(":disabled") && !el.closest('[aria-disabled="true"],[inert],a[href],form');
    }
    for (let el = hit; el && el !== doc.body; el = el.parentElement) {
      if (!el.matches(`${poster},button,[role="button"],[title],[aria-label]`) || !isPlayButton(el)) continue;
      let scope = el.parentElement;
      while (scope && !scope.contains(video)) scope = scope.parentElement;
      if (scope?.querySelectorAll("video").length === 1) return el;
      return null;
    }
    if (hit === video && video.controls) return video;
    const player = video.closest(".video-js,.prism-player,.xgplayer,[data-vjs-player]") || video.parentElement;
    if (!player || player === doc.body || !player.contains(hit) || player.querySelectorAll("video").length !== 1) return null;
    for (const button of player.querySelectorAll(`${poster},button,[role="button"]`)) {
      if (visible(button) && isPlayButton(button) && button.contains(exposedCenter(button))) return button;
    }
    return null;
  }

  function queuePlayer(node, page) {
    if (!entry) return;
    const index = page.players.indexOf(node);
    entry.startup = { node, index, previous: page.players[index - 1], known: new Set(page.players), initialTime: node.currentTime,
      attempts: 0, retryAt: 0 };
    observeDocuments(page.documents);
    checkPlayerStart(page);
  }

  function checkPlayerStart(page) {
    const state = entry.startup;
    const { players, pdfs } = page;
    if (!players.includes(state.node)) {
      // A course iframe can replace its poster, or its whole document, during initialization.
      const previousIndex = players.indexOf(state.previous);
      const replacement = players[previousIndex < 0 ? state.index : previousIndex + 1];
      if (!replacement || state.known.has(replacement) || (state.node.tagName === "VIDEO" && pdfs.has(replacement))) {
        playback.textContent = "正在等待当前位置的播放器重新载入。";
        return;
      }
      reveal(replacement);
      queuePlayer(replacement, page);
      return;
    }
    const video = state.node;
    if (pdfs.has(video)) {
      beginReading(video, entry.chapter, page);
      return;
    }
    if (video.tagName !== "VIDEO") {
      playback.textContent = "已定位到嵌入课件，正在等待播放器。若画面中是 PDF，可点「从当前 PDF 继续」。";
      return;
    }
    if (video.ended) return;
    if (video.error) {
      playback.textContent = "播放器报告视频加载失败。可使用原播放器重试，载入后助手会继续。";
      return;
    }
    if (!video.paused || hasPlayingVideo(players)) {
      if (!video.paused && !video.seeking && video.currentTime > state.initialTime + 0.1) {
        entry.startup = null;
        playback.textContent = `正在播放本页第 ${players.indexOf(video) + 1} 个播放器。`;
        return;
      }
      playback.textContent = "正在等待视频开始播放或完成缓冲。";
      return;
    }
    if (state.blockedSource !== undefined && state.blockedSource === taskVersion(video)) return;
    const now = performance.now();
    if (now < state.retryAt) return;
    const control = centerControl(video);
    if (!control) {
      if (!visibleArea(video) && now >= (state.revealAt || 0)) {
        reveal(video);
        state.revealAt = now + 4000;
      }
      playback.textContent = "正在等待可点击的播放控件。控件就绪后会自动重试。";
      return;
    }
    state.attempts++;
    state.retryAt = now + Math.min(30_000, 2500 * 2 ** Math.min(state.attempts - 1, 4));
    playback.textContent = state.attempts === 1 ? "已请求播放，正在确认视频是否启动。" :
      `视频仍暂停，已第 ${state.attempts} 次请求播放。也可点播放器上的 ▶ 继续。`;
    if (control !== video) {
      control.click();
      return;
    }
    const source = taskVersion(video);
    video.play().catch((error) => {
      if (entry?.startup !== state || error.name !== "NotAllowedError" || source !== taskVersion(video)) return;
      state.blockedSource = source;
      playback.textContent = "浏览器要求手动开始这段视频。请点播放器上的 ▶，播完会自动接续。";
    });
  }

  const readerFrames = "iframe, frame, embed, object";

  function readerAtPoint(doc, x, y) {
    let hit = doc.elementFromPoint(x, y);
    while (hit?.shadowRoot) {
      const deeper = hit.shadowRoot.elementFromPoint(x, y);
      if (!deeper || deeper === hit) break;
      hit = deeper;
    }
    for (let el = hit; el; el = el.parentElement || el.getRootNode().host) {
      if (el.matches(readerFrames)) {
        const child = el.contentDocument;
        if (!child?.documentElement || child.contentType === "application/pdf") return el;
        const rect = el.getBoundingClientRect();
        const childX = (x - rect.left) * el.offsetWidth / rect.width - el.clientLeft;
        const childY = (y - rect.top) * el.offsetHeight / rect.height - el.clientTop;
        const inner = readerAtPoint(child, childX, childY);
        return inner || el;
      }
      if (el.scrollHeight <= el.clientHeight + 2) continue;
      // With overflow propagated from body to the viewport, body.scrollTop never changes.
      if (el === doc.body && doc.scrollingElement === doc.documentElement &&
          doc.defaultView.getComputedStyle(doc.documentElement).overflowY === "visible" &&
          doc.documentElement.scrollHeight > doc.documentElement.clientHeight + 2) return doc.documentElement;
      if (el === doc.scrollingElement || /^(auto|scroll|overlay)$/.test(doc.defaultView.getComputedStyle(el).overflowY)) return el;
    }
    return null;
  }

  function readerSurface(node) {
    const doc = node.contentDocument;
    if (!doc?.documentElement || doc.contentType === "application/pdf") return node;
    const win = doc.defaultView;
    const votes = new Map();
    // Probe the page body, away from thumbnail columns and the bottom zoom toolbar.
    for (const [fx, fy] of [[0.54, 0.46], [0.72, 0.32], [0.66, 0.67]]) {
      const target = readerAtPoint(doc, win.innerWidth * fx, win.innerHeight * fy);
      if (target) votes.set(target, (votes.get(target) || 0) + 1);
    }
    if (votes.size) return [...votes.keys()].sort((a, b) => votes.get(b) - votes.get(a))[0];
    // Some viewers expand the frame to the document height and put its scrollbar on a wrapper.
    if (doc.querySelector(readerFrames) || !doc.querySelector("img,canvas,.pdfViewer .page,[data-page-number]")) return null;
    for (let el = node.parentElement; el && el !== node.ownerDocument.body; el = el.parentElement) {
      if (el.querySelectorAll(resources).length !== 1) break;
      if (el.clientHeight + 2 < node.offsetHeight && Math.abs(el.scrollHeight - node.offsetHeight) < 64 &&
          /^(auto|scroll|overlay)$/.test(el.ownerDocument.defaultView.getComputedStyle(el).overflowY)) return el;
    }
    return null;
  }

  function platformReaderTargets(card, blocked) {
    const targets = new Set();
    function add(win) {
      if (!win) return;
      // The platform's /screen/file URL can redirect to a granted external reader.
      try {
        if (win.location.origin === location.origin &&
            ["/ananas/modules/pdf/index.html", "/mooc-ans/screen/file"].includes(win.location.pathname)) targets.add(win);
      } catch (error) { if (error.name !== "SecurityError") throw error; }
    }
    for (const node of [blocked, card]) {
      for (let doc = node?.ownerDocument; doc && doc !== document; doc = doc.defaultView.frameElement?.ownerDocument) {
        add(doc.defaultView);
      }
      if (node?.matches("iframe, frame")) add(node.contentWindow);
    }
    return targets;
  }

  function requestReaderScroll(target, mode) {
    return new Promise((resolve) => {
      const { port1, port2 } = new MessageChannel();
      function done(status) {
        clearTimeout(timer);
        port1.close();
        resolve(status);
      }
      const timer = setTimeout(() => done("unavailable"), 3500);
      port1.onmessage = (event) => done(event.data);
      try {
        target.postMessage({ type: "ucas-scroll-current-pdf", speed: mode }, location.origin, [port2]);
      } catch {
        port2.close();
        done("unavailable");
      }
    });
  }

  function stableBottom(state, surface, extent) {
    if (!surface || !Number.isFinite(extent) || extent <= 1) return false;
    if (state.bottom?.surface !== surface || state.bottom.extent !== extent) {
      state.bottom = { surface, extent, since: performance.now() };
      return false;
    }
    return performance.now() - state.bottom.since >= 1600;
  }

  async function scrollPlatformReader(state, targets, directFrame) {
    const messages = {
      scrolling: "正在滚动校方阅读器里的 PDF 正文。",
      manual: "PDF 已设为手动滚动。",
      stalled: "PDF 滚动位置没有变化。可手动滚到底，再点「我已读完此 PDF，继续」。",
      loading: "正在等待校方 PDF 正文载入。",
      native: "请在浏览器内置阅读器中滚到底，再点「我已读完此 PDF，继续」。",
      "no-access": "请在 PDF 正文上右击，选择「为此 PDF 站点启用滚动」，在 Edge 中允许该站点。",
      ambiguous: "检测到多个预览窗口。请在当前 PDF 正文内滚到底，再点「我已读完此 PDF，继续」。"
    };
    let status;
    if (state.grantedWindow) {
      let win = state.grantedWindow;
      while (win && win !== state.node.contentWindow && win !== win.parent) win = win.parent;
      if (win !== state.node.contentWindow) state.grantedWindow = null;
    }
    const direct = !targets.size && (state.grantedWindow || directFrame?.contentWindow);
    if (direct) targets.add(direct);
    for (const target of targets) {
      if (!await foreground() || reading !== state || !enabled || state.chapter !== chapterKey()) return true;
      const result = direct ? await globalThis.__ucasReadPdfFrame(target, { speed: speed.value },
        () => reading === state && enabled && document.visibilityState === "visible" && state.chapter === chapterKey()).catch(() => "stalled") :
        await requestReaderScroll(target, speed.value);
      if (reading !== state || !enabled || state.chapter !== chapterKey()) return true;
      if (result?.status === "bottom") {
        if (stableBottom(state, result.surface, result.extent)) await finishReading(state);
        else playback.textContent = "PDF 正文已到底，正在确认末页已稳定。";
        return true;
      }
      state.bottom = null;
      if (result === "course-card-complete" && !direct) {
        await finishReading(state);
        return true;
      }
      if (direct && result === "no-access") {
        state.grantedWindow = null;
      }
      if (!Object.hasOwn(messages, result)) continue;
      status = result;
      if (!["isolated", "native", "loading"].includes(result)) break;
    }
    if (!status) return false;
    playback.textContent = messages[status];
    return true;
  }

  function stopReading() {
    clearInterval(reading?.timer);
    reading = undefined;
    shadow.getElementById("finished").hidden = true;
  }

  async function finishReading(state) {
    if (!await foreground() || reading !== state || !enabled || chapterKey() !== state.chapter) return;
    const page = snapshot();
    if (!page.players.includes(state.node) || hasPlayingVideo(page.players)) return;
    stopReading();
    entry?.readPdfs.set(state.node, taskVersion(state.node));
    // Only pick up a newly mounted video here. An earlier player's poster can reset after it ends.
    const missed = state.earlierVideos && page.players.slice(0, page.players.indexOf(state.node)).find((video) =>
      video.tagName === "VIDEO" && !state.earlierVideos.has(video) && !state.earlierVideos.has(taskVersion(video)) &&
      !video.ended && !cardInfo(video).complete);
    if (missed) {
      reveal(missed);
      queuePlayer(missed, page);
    } else {
      continueAfter(state.node, page, state);
    }
  }

  function beginReading(node, chapter, page) {
    if (entry) entry.startup = null;
    stopReading();
    const players = (page || snapshot()).players;
    const index = players.indexOf(node);
    const state = { node, chapter, index, before: players[index - 1], peers: new Set(players.filter((item) => item !== node)) };
    if (page) {
      const earlier = players.slice(0, index).filter((item) => item.tagName === "VIDEO");
      state.earlierVideos = new Set([...earlier, ...earlier.map(taskVersion).filter(Boolean)]);
    }
    reading = state;
    shadow.getElementById("finished").hidden = false;
    playback.textContent = "已进入 PDF，正文滚到底后自动继续。";
    async function check() {
      if (!await foreground() || reading !== state) return;
      if (!enabled || chapterKey() !== chapter) { stopReading(); return; }
      let outer = node;
      while (outer?.isConnected && outer.ownerDocument !== document) outer = outer.ownerDocument.defaultView?.frameElement;
      if (!outer?.isConnected) {
        const fresh = snapshot();
        const before = fresh.players.indexOf(state.before);
        const replacement = fresh.players[before < 0 ? state.index : before + 1];
        if (!fresh.pdfs.has(replacement) || state.peers.has(replacement)) {
          playback.textContent = "正在等待这一份 PDF 的阅读器重新载入。";
          return;
        }
        node = state.node = replacement;
        state.bottom = null;
        state.grantedWindow = null;
        reveal(node);
      }
      if (cardInfo(node).complete) { finishReading(state); return; }
      if (!visibleArea(node)) return;
      // A connected outer shell may outlive several different inner viewers.
      const targets = platformReaderTargets(node);
      const box = targets.size ? null : readerSurface(node);
      if (targets.size || !box || box.matches(readerFrames)) {
        if (await scrollPlatformReader(state, targets.size ? targets : platformReaderTargets(node, box), box)) return;
        if (reading !== state) return;
        const address = box?.getAttribute("src") || box?.getAttribute("data");
        const host = address && URL.canParse(address, box.baseURI) ? new URL(address, box.baseURI).hostname : "";
        playback.textContent = box
          ? `无法操作这个嵌入阅读器${host ? `（${host}）` : ""}的内部滚动条。请手动滚到底，再点「我已读完此 PDF，继续」。`
          : "正在等待 PDF 正文的滚动区加载。";
        return;
      }
      const atBottom = box.scrollHeight - box.clientHeight - box.scrollTop <= 1;
      if (atBottom) {
        if (stableBottom(state, box, box.scrollHeight - box.clientHeight)) await finishReading(state);
        else playback.textContent = "PDF 正文已到底，正在确认末页已稳定。";
        return;
      }
      state.bottom = null;
      if (speed.value === "end") {
        box.scrollTo({ top: box.scrollHeight, behavior: "instant" });
        playback.textContent = "正在滚动 PDF 正文，并检查是否载入新页。";
      } else if (Number(speed.value) > 0) {
        box.scrollBy({ top: Number(speed.value) / 2, behavior: "smooth" });
        playback.textContent = "正在按所选速度滚动 PDF，滚到底后继续。";
      } else {
        playback.textContent = "PDF 已设为手动滚动。";
      }
    }
    async function tick() {
      if (state.busy) return;
      state.busy = true;
      try { await check(); } finally { state.busy = false; }
    }
    state.timer = setInterval(tick, 500);
    tick();
  }

  bindButton("finished", () => { if (reading) finishReading(reading); });
  bindButton("read", () => {
    const page = snapshot();
    if (!enabled) return;
    if (hasPlayingVideo(page.players)) {
      playback.textContent = "本页有视频正在播放。暂停视频后可从当前 PDF 继续。";
      return;
    }
    const embeds = page.players.filter((node) => node.tagName !== "VIDEO" && visibleArea(node) > 0);
    const pdfs = embeds.filter((node) => page.pdfs.has(node));
    const cards = (pdfs.length ? pdfs : embeds).sort((a, b) => visibleArea(b) - visibleArea(a));
    let target = cards[0];
    if (cards[1] && visibleArea(cards[1]) > visibleArea(target) * 0.8) {
      target = cards.find((node) => node === reading?.node && visibleArea(node) > visibleArea(cards[0]) * 0.8);
    }
    if (!target) {
      playback.textContent = "请先把要阅读的 PDF 滚到页面中央，再点「从当前 PDF 继续」。";
      return;
    }
    cancelPending();
    beginReading(target, chapterKey());
  });

  async function advance(run) {
    if (pending !== run) return;
    if (document.fullscreenElement && await foreground() && pending === run) {
      try {
        await document.exitFullscreen();
      } catch {
        cancelPending();
        playback.textContent = "退出全屏失败，请用课程目录进入下一节。";
        return;
      }
    }
    if (!await foreground() || pending !== run) return;
    cancelPending();
    const page = snapshot();
    const { players } = page;
    const index = players.indexOf(run.video);
    if (!enabled || chapterKey() !== run.chapter ||
        index < 0 || !run.source || ends.get(run.video) !== run.source || run.video.currentSrc !== run.source ||
        run.video.seeking || run.video.error || hasPlayingVideo(players)) {
      playback.textContent = "播放页面已改变，可在当前节点继续观看。";
      return;
    }
    continueAfter(run.video, page, run);
  }

  function nextTask(current, { players, pdfs }) {
    return players.slice(current ? players.indexOf(current) + 1 : 0).find((node) => {
      if (pdfs.has(node)) return !pdfs.get(node).complete && entry?.readPdfs.get(node) !== taskVersion(node);
      if (!current && node.tagName === "VIDEO" && node.paused && cardInfo(node).complete) return false;
      return node.tagName !== "VIDEO" || !(node.ended || (node.currentSrc && ends.get(node) === node.currentSrc));
    });
  }

  function continueAfter(current, page, run) {
    const { pdfs } = page;
    const next = nextTask(current, page);
    if (next) {
      reveal(next);
      if (pdfs.has(next)) {
        beginReading(next, run.chapter, page);
      } else {
        queuePlayer(next, page);
      }
      return;
    }
    if (!current) {
      playback.textContent = "本节暂未识别到待查看的任务，请核对课程目录。";
      return;
    }
    openNextSection(page);
  }

  function rememberNextClick(page) {
    const heading = chapterHeading(document);
    entry.startup = null;
    entry.tasks = taskVersions(page.players);
    entry.nextClick = { ...heading, practice: entry.practice || practiceTask(page, heading), time: performance.now() };
    entry.awaitingFooter = false;
  }

  function trackNextClick(event) {
    if (!event.isTrusted || !enabled || !entry || entry.nextClick || document.visibilityState !== "visible") return;
    const path = event.composedPath();
    if (!path.slice(0, 4).some((node) => {
      const text = node.getAttribute?.("aria-label") || node.value || node.textContent || "";
      return text.length < 30 && nextLabel.test(normalize(text));
    })) return;
    const page = snapshot();
    if (!path.includes(nextControl(page.documents, location.origin))) return;
    cancelPending();
    stopReading();
    rememberNextClick(page);
  }

  function confirmUnfinished(control) {
    if (entry.nextClick.confirmed) return;
    entry.nextClick.confirmed = true;
    playback.textContent = "章节仍有未完成任务，已选择弹窗中的「下一节」。";
    control.click();
  }

  function openNextSection(page) {
    if (!entry || entry.nextClick) return;
    const { documents } = page;
    let control;
    if (entry.practice) {
      const dialogNext = unfinishedDialogNext(documents);
      if (dialogNext) {
        rememberNextClick(page);
        confirmUnfinished(dialogNext);
        return;
      }
      scrollPracticeBottom(documents, entry.practice.node);
      const footers = documents.flatMap((doc) => [...doc.querySelectorAll('footer,[role="contentinfo"]')].filter(inLesson));
      control = nextControl(footers, location.origin, nextLabel, true);
    }
    control ??= nextControl(documents, location.origin, nextLabel, Boolean(entry.practice));
    entry.awaitingFooter = !control;
    if (!control) {
      playback.textContent = entry.practice ? "正在跳过习题，等待页底的「下一节」。" :
        "已到本页末项。下一节入口未出现、不可用或有多个，请查看目录。";
      return;
    }
    ends = new WeakMap();
    playback.textContent = "已点击下一节。连续切换已开启。";
    rememberNextClick(page);
    reveal(control);
    control.click();
  }

  function taskVersion(node) {
    return node.currentSrc || node.src || node.data || node.querySelector("source[src]")?.src || "";
  }

  function taskVersions(nodes) {
    return new Map(nodes.map((node) => [node, taskVersion(node)]));
  }

  async function checkEntry() {
    if (!enabled || document.visibilityState !== "visible" || numericParam(new URL(location.href), "courseid") !== courseId) return;
    const chapter = chapterKey();
    const heading = chapterHeading(document);
    const { title } = heading;
    let changed = chapter !== entry?.chapter ||
      (heading.node && title !== entry.heading.title && (entry.heading.node || quizName.test(title)));
    if (!changed && entry.started && !entry.startup && !entry.nextClick && !entry.awaitingFooter && !readerGrant?.source) return;
    if (!await foreground() || !enabled || chapter !== chapterKey()) return;
    let page;
    if (readerGrant && readerGrant.chapter !== chapter) readerGrant = null;
    if (!changed && entry.nextClick) {
      // Some course templates replace the lesson in place and keep the same address.
      page = snapshot();
      const confirm = unfinishedDialogNext(page.documents);
      if (confirm) {
        confirmUnfinished(confirm);
        return;
      }
      const previousTaskPresent = page.players.some((node) => entry.tasks.get(node) === taskVersion(node));
      const practice = practiceTask(page, heading);
      const outgoing = entry.nextClick.practice;
      const newPractice = practice && (!outgoing || practice.title !== outgoing.title);
      const newMedia = page.players.length && (outgoing ? !practice : entry.tasks.size);
      if (previousTaskPresent || (!newMedia && !newPractice)) {
        if (performance.now() - entry.nextClick.time >= 15_000) {
          playback.textContent = "已点击「下一节」，仍在等待新课件。请查看页面是否提示解锁条件。";
        }
        return;
      }
      changed = true;
    }
    if (changed) {
      const previous = entry?.tasks || entry?.previous;
      const previousHeading = entry?.nextClick || entry?.heading;
      const previousPractice = entry?.nextClick?.practice || entry?.practice || entry?.previousPractice;
      cancelPending();
      stopReading();
      entry = { chapter, heading, previous, previousHeading, previousPractice, readPdfs: new WeakMap(), started: false };
      playback.textContent = "已进入新节点，正在从页首查找课件。";
    } else if (heading.node) {
      entry.heading = heading;
    }
    page ??= snapshot();
    if (readerGrant?.source) {
      const selected = readerGrant.source;
      readerGrant = null;
      if (!entry.nextClick && !entry.practice && !hasPlayingVideo(page.players)) {
        const cards = [...page.pdfs.keys()];
        for (let win = selected; win && win !== window; win = win.parent) {
          const card = cards.find((item) => item.contentWindow === win);
          if (!card) continue;
          if (reading?.node === card && !visibleArea(card)) reveal(card);
          if (!reading && !pending && !entry.startup && !page.pdfs.get(card).complete && entry.readPdfs.get(card) !== taskVersion(card)) {
            cancelPending();
            entry.started = true;
            entry.awaitingFooter = false;
            reveal(card);
            beginReading(card, chapter);
          }
          if (reading?.node === card) reading.grantedWindow = selected;
          return;
        }
      }
    }
    if (entry.awaitingFooter) {
      openNextSection(page);
      return;
    }
    const practice = practiceTask(page, heading);
    if (practice) {
      // The URL can change before the previous Quiz heading has been replaced.
      if ((practice.title === entry.previousHeading?.title && practice.node === entry.previousHeading.node) ||
          (practice.title === entry.previousPractice?.title && practice.node === entry.previousPractice.node)) return;
      if (entry.quizTitle !== practice.title) {
        entry.quizTitle = practice.title;
        entry.quizSince = performance.now();
        return;
      }
      if (performance.now() - entry.quizSince < 1500) return;
      entry.practice = practice;
      entry.startup = null;
      entry.started = true;
      openNextSection(page);
      return;
    }
    entry.quizTitle = undefined;
    if (entry.startup) {
      checkPlayerStart(page);
      return;
    }
    if (entry.started) return;
    if (!hasPlayingVideo(page.players)) scrollChapterTop(page);
    if (!page.players.length) return;
    const first = nextTask(null, page);
    // A single-page navigation can change the chapter ID before replacing the old player.
    if (first && entry.previous?.has(first) && entry.previous.get(first) === taskVersion(first)) return;
    if (!first || page.pdfs.has(first)) {
      if (!first && page.players.some((node) => entry.previous?.get(node) === taskVersion(node))) return;
      // Returning to the top can trigger lazy video mounting above an already rendered PDF.
      const stable = entry.initialTasks;
      if (!stable || stable.size !== page.players.length || page.players.some((node) => stable.get(node) !== taskVersion(node))) {
        entry.initialTasks = taskVersions(page.players);
        entry.stableSince = performance.now();
        return;
      }
      if (page.documents.some((doc) => doc.readyState === "loading") || performance.now() - entry.stableSince < 3000) return;
    } else {
      entry.initialTasks = undefined;
    }
    entry.tasks = taskVersions(page.players);
    entry.started = true;
    observeDocuments(page.documents);
    const activeVideo = page.players.find((node) => node.tagName === "VIDEO" && !node.paused && !node.ended);
    if (activeVideo) {
      if (!activeVideo.played.length || activeVideo.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) queuePlayer(activeVideo, page);
    } else {
      continueAfter(first ? null : page.players.at(-1), page, { chapter });
    }
  }

  function watchEntries() {
    let checking = false;
    async function tick() {
      if (checking) return;
      checking = true;
      try { await checkEntry(); } finally { checking = false; }
    }
    entryTimer = setInterval(tick, 600);
    tick();
  }

  async function onVideoEnded(event) {
    const video = event.target;
    if (!event.isTrusted || video.tagName !== "VIDEO" || !await foreground() || !enabled || !video.ended) return;
    if (entry?.nextClick || quizName.test(currentChapter(document)) || numericParam(new URL(location.href), "courseid") !== courseId) return;
    const { players } = snapshot();
    if (!players.includes(video)) return;
    ends.set(video, video.currentSrc);
    cancelPending();
    const run = { chapter: chapterKey(), video, source: video.currentSrc };
    pending = run;
    playback.textContent = "本段已播完，正在检查下方是否还有视频。";
    run.timer = setTimeout(() => advance(run), 3000);
  }

  bindButton("stop", () => setMode(false));
  bindButton("arm", () => setMode(true));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") cancelPending();
  });
  window.addEventListener("pagehide", () => { cancelPending(); stopReading(); });
  if (enabled) watchEntries();
})();
