// DIMY の拡張機能（裏で動く部分）
// - ディミの画面からの頼み（画面の写真）を受けて実行する
// - フォルダの中身が自動更新で新しくなったら、自分を読み込み直す（chrome://extensions を開かなくても新しい版になる）

// ディミのタブの中の枠（iframe）だけ、ページの「中に表示しないで」の印を外す。
// rules.json は、ディミの画面から直接開いたページに効く。枠の中でリンクを押して次のページへ進んだときは
// 頼み主がそのサイトになるため、ここでディミのタブ（tabIds）に対する決まりを足して、枠の中のどのページにも効かせる。
const HEADERS = ["x-frame-options", "content-security-policy", "cross-origin-opener-policy", "cross-origin-embedder-policy", "cross-origin-resource-policy"];
const ruleId = (tabId) => 1000 + (tabId % 100000);
async function allowFramesIn(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [ruleId(tabId)],
    addRules: [
      {
        id: ruleId(tabId),
        priority: 2,
        action: { type: "modifyHeaders", responseHeaders: HEADERS.map((header) => ({ header, operation: "remove" })) },
        condition: { resourceTypes: ["sub_frame"], tabIds: [tabId] },
      },
    ],
  });
}
async function stopFramesIn(tabId) {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] }).catch(() => {});
}
const isDimy = (url) => /^(https:\/\/dimy\.dxdimix\.com|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\//.test(url || "");
chrome.tabs.onRemoved.addListener((tabId) => stopFramesIn(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  // ディミ以外のページへ移ったタブは、決まりを外す
  if (info.url && !isDimy(info.url)) stopFramesIn(tabId);
});

// この Chrome が「DIMY が動いているデスクトップ PC」か。PC の DIMY が、この拡張機能のフォルダに印（host.json）を置く。
// ノート PC などに手で入れた拡張機能には、印がない
async function isDimyPc() {
  try {
    const res = await fetch(chrome.runtime.getURL("host.json"), { cache: "no-store" });
    return res.ok && (await res.json()).pc === true;
  } catch {
    return false;
  }
}

// 画面の写真: 頼んできたディミのタブがあるウィンドウの、見えている部分を撮る
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === "hello" && sender.tab?.id !== undefined && isDimy(sender.tab.url)) {
    relaxChatgptCookies();
    Promise.all([allowFramesIn(sender.tab.id).catch(() => {}), isDimyPc()])
      .then(([, pc]) => reply({ ok: true, pc }))
      .catch((e) => reply({ ok: false, error: String(e?.message || e) }));
    return true;
  }
  if (msg?.type === "capture") {
    const windowId = sender.tab?.windowId;
    chrome.tabs
      .captureVisibleTab(windowId, { format: "jpeg", quality: 70 })
      .then((dataUrl) => reply({ ok: true, dataUrl }))
      .catch((e) => reply({ ok: false, error: String(e?.message || e) }));
    return true; // あとで返事をする
  }
  if (msg?.type === "version") {
    reply({ ok: true, version: chrome.runtime.getManifest().version });
    return false;
  }
});

// 新しい版の確認: フォルダの manifest.json（自動更新で書き換わる）と、今動いている版を比べる
async function checkUpdate() {
  try {
    const res = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    const onDisk = (await res.json()).version;
    if (onDisk && onDisk !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch {
    /* 読めなければ次の機会に */
  }
}
chrome.alarms.create("dimy-update", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "dimy-update") checkUpdate();
});
chrome.runtime.onStartup.addListener(checkUpdate);

// 入れたとき・新しい版になったとき: 開いているディミのタブに、取り次ぎ（content.js）を入れ直す
// （古い取り次ぎは拡張機能とつながらなくなるため。ページは読み込み直さない）
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: ["https://dimy.dxdimix.com/*", "http://localhost/*", "http://127.0.0.1/*"] });
  for (const t of tabs) {
    if (t.id === undefined) continue;
    chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] }).catch(() => {});
  }
});

// ChatGPT（chatgpt.com）を、ディミの中のカードでもログインした状態で使えるようにする（利用者が選んだ: 安全性は少し下がる）。
// Chrome は、ほかのサイトの枠の中には SameSite=Lax / Strict のログイン情報（Cookie）を送らない。
// そこで chatgpt.com の Cookie だけ SameSite=None（どこからでも送る）に書き換える。ChatGPT が書き戻したら、また書き換える。
// ほかのサイトの Cookie には触れない。中身（値）は読み取って同じものを書き直すだけで、どこにも送らない。
const CHATGPT = /(^|\.)chatgpt\.com$/;
async function relaxCookie(c) {
  if (!CHATGPT.test(c.domain.replace(/^\./, "")) || c.sameSite === "no_restriction") return;
  const host = c.domain.replace(/^\./, "");
  const details = {
    url: `https://${host}${c.path || "/"}`,
    name: c.name,
    value: c.value,
    path: c.path,
    secure: true,
    httpOnly: c.httpOnly,
    sameSite: "no_restriction",
    storeId: c.storeId,
  };
  if (!c.hostOnly) details.domain = c.domain;
  if (!c.session && c.expirationDate) details.expirationDate = c.expirationDate;
  try {
    await chrome.cookies.set(details);
  } catch {
    /* 書き換えられないものは飛ばす */
  }
}
async function relaxChatgptCookies() {
  const all = await chrome.cookies.getAll({ domain: "chatgpt.com" }).catch(() => []);
  for (const c of all) await relaxCookie(c);
}
chrome.cookies.onChanged.addListener(({ removed, cookie }) => {
  if (!removed) relaxCookie(cookie);
});
chrome.runtime.onStartup.addListener(relaxChatgptCookies);
chrome.runtime.onInstalled.addListener(relaxChatgptCookies);
