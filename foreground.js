// Verify the actual foreground tab after a navigation leaves the new document without DOM focus.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message !== "study-tab-in-foreground" || !sender.tab) return;
  Promise.all([chrome.tabs.get(sender.tab.id), chrome.windows.get(sender.tab.windowId)]).then(([tab, win]) => {
    respond(tab.active && tab.windowId === win.id && win.focused && win.state !== "minimized");
  }).catch(() => respond(false));
  return true;
});

const readerMenu = "enable-current-pdf-site";
const courseOrigin = new URL(chrome.runtime.getManifest().content_scripts[0].matches[0]).origin;

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: readerMenu, title: "为此 PDF 站点启用滚动", contexts: ["frame"],
    documentUrlPatterns: ["https://*/*"]
  });
  if (details.reason !== "install") restoreReaderSites().catch(console.error);
});

async function registerReaderSite(pattern) {
  const id = "reader-site-" + new URL(pattern).hostname;
  if ((await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) return;
  try {
    await chrome.scripting.registerContentScripts([{
      id, matches: [pattern], js: ["pdf-module.js"], allFrames: true, persistAcrossSessions: true
    }]);
  } catch (error) {
    if (!(await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length) throw error;
  }
}

async function restoreReaderSites() {
  // An unpacked extension reload can clear dynamic scripts while preserving its site grants.
  const { origins = [] } = await chrome.permissions.getAll();
  const sites = origins.filter((pattern) => /^https:\/\/[^*/]+\/\*$/.test(pattern));
  await Promise.all(sites.map(registerReaderSite));
}

function isCourse(address) {
  if (!address || !URL.canParse(address)) return false;
  const url = new URL(address);
  return url.origin === courseOrigin && url.pathname.includes("/mycourse/") &&
    [...url.searchParams].some(([key, value]) => key.toLowerCase() === "courseid" && value === "350140000041158");
}

async function enableReader(info, tab) {
  if (info.menuItemId !== readerMenu || !tab?.id || !(info.frameId > 0) || !isCourse(tab.url || info.pageUrl)) return;
  const report = (text) => chrome.tabs.sendMessage(tab.id, { type: "pdf-access-result", text }, { frameId: 0 }).catch(() => {});
  if (!URL.canParse(info.frameUrl)) return report("Edge 没有提供正文的站点地址。请在 PDF 页面的文字或图片上右击。");
  const url = new URL(info.frameUrl);
  if (url.protocol !== "https:") return report("这个阅读器没有可授权的 HTTPS 站点。请在 PDF 正文内滚动。");
  if (url.origin === courseOrigin && url.pathname === "/ananas/modules/pdf/index.html") {
    return report("你点到了课件外框。请在 PDF 页面中间的文字或封面图片上右击。");
  }
  // Request the one host identified by the browser, within this context-menu user gesture.
  const pattern = `https://${url.hostname}/*`;
  try {
    const permission = { origins: [pattern] };
    // Start the request in the menu gesture. An existing grant also suffices to attach the reader.
    const allowed = await chrome.permissions.request(permission).catch(() => chrome.permissions.contains(permission));
    if (!allowed) return report("未获得 " + url.hostname + " 的访问权限。需要时可在正文上再次右击。");
    await registerReaderSite(pattern);
    const current = await chrome.tabs.get(tab.id);
    if (current.url !== (tab.url || info.pageUrl) || !isCourse(current.url)) return;
    const attach = (frameIds) => chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds }, files: ["pdf-module.js"]
    });
    await attach([info.frameId]);
    const token = crypto.randomUUID();
    await chrome.tabs.sendMessage(tab.id, {
      type: "pdf-access-result", token, origin: url.origin, text: "已为 " + url.hostname + " 启用滚动，可在当前 PDF 继续。"
    }, { frameId: 0 });
    await chrome.tabs.sendMessage(tab.id, { type: "pdf-identify-reader", token }, { frameId: info.frameId }).catch(() => {});
    // Other PDFs on the same lesson may already have loaded before the host grant.
    const frames = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true }, func: () => location.origin
    }).catch(() => []);
    const siblings = frames.filter((frame) => frame.frameId > 0 && frame.frameId !== info.frameId && frame.result === url.origin);
    await Promise.allSettled(siblings.map((frame) => attach([frame.frameId])));
  } catch {
    await report("Edge 未能为 " + url.hostname + " 启用滚动。请检查扩展的站点访问设置后再试。");
  }
}
chrome.contextMenus.onClicked.addListener(enableReader);
