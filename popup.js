const $ = (s) => document.querySelector(s);

let tabId = null;
let entries = [];
let editingKey = null; // null = đang thêm mới
let toastTimer = null;

/* ---------- Helpers ---------- */

const byteSize = (s) => new Blob([s]).size;
const fmtSize = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

function isJSON(v) {
  try {
    const o = JSON.parse(v);
    return o !== null && typeof o === "object";
  } catch {
    return false;
  }
}

function toast(msg, actionLabel, onAction) {
  clearTimeout(toastTimer);
  $("#toast-msg").textContent = msg;
  const btn = $("#toast-action");
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.onclick = () => {
      onAction();
      $("#toast").classList.add("hidden");
    };
    btn.classList.remove("hidden");
  } else {
    btn.classList.add("hidden");
  }
  $("#toast").classList.remove("hidden");
  toastTimer = setTimeout(
    () => $("#toast").classList.add("hidden"),
    actionLabel ? 5000 : 2200,
  );
}

/* ---------- Chạy code trong trang hiện tại ---------- */

async function run(func, args = []) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return r.result;
}

const pageGetAll = () => ({
  origin: location.origin,
  items: Array.from({ length: localStorage.length }, (_, i) => {
    const key = localStorage.key(i);
    return { key, value: localStorage.getItem(key) };
  }),
});
const pageSet = (k, v) => localStorage.setItem(k, v);
const pageRemove = (k) => localStorage.removeItem(k);
const pageClear = () => localStorage.clear();
const pageImport = (obj) =>
  Object.entries(obj).forEach(([k, v]) =>
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v)),
  );

/* ---------- Load & render ---------- */

async function load() {
  try {
    const data = await run(pageGetAll);
    entries = data.items;
    $("#origin").textContent = data.origin;
    $("#origin").title = data.origin;
    render();
  } catch (e) {
    entries = [];
    $("#origin").textContent = "Không truy cập được trang này";
    $("#meta").textContent = "";
    $("#list").innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent =
      "Extension không chạy được trên trang này (chrome://, Web Store, PDF...). Hãy mở một trang web bình thường.";
    $("#list").append(div);
  }
}

function render() {
  const q = $("#search").value.trim().toLowerCase();
  const list = entries
    .filter(
      (e) =>
        !q ||
        e.key.toLowerCase().includes(q) ||
        e.value.toLowerCase().includes(q),
    )
    .sort((a, b) => a.key.localeCompare(b.key));

  const total = entries.reduce((s, e) => s + byteSize(e.key + e.value), 0);
  $("#meta").textContent =
    `${list.length}/${entries.length} items · ${fmtSize(total)}`;

  const root = $("#list");
  root.innerHTML = "";

  if (!list.length) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = entries.length
      ? "Không có item nào khớp."
      : 'localStorage đang trống. Bấm "Thêm item" để tạo mới.';
    root.append(div);
    return;
  }

  for (const e of list) {
    const row = document.createElement("div");
    row.className = "row";
    row.tabIndex = 0;

    const main = document.createElement("div");
    main.className = "row-main";
    const key = document.createElement("div");
    key.className = "key";
    key.textContent = e.key;
    key.title = e.key;
    if (isJSON(e.value)) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = "JSON";
      key.append(b);
    }
    const val = document.createElement("div");
    val.className = "val";
    const display = e.value.replace(/^"|"$/g, "");
    val.textContent = display === "" ? "(rỗng)" : display.slice(0, 500);
    main.append(key, val);

    const size = document.createElement("div");
    size.className = "size";
    size.textContent = fmtSize(byteSize(e.key + e.value));

    const actions = document.createElement("div");
    actions.className = "row-actions";
    actions.append(
      mkBtn("Copy", () => copy(e.value)),
      mkBtn("Xóa", () => remove(e)),
    );

    row.append(main, size, actions);
    row.addEventListener("click", () => openModal(e));
    row.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") openModal(e);
    });
    root.append(row);
  }
}

function mkBtn(label, fn) {
  const b = document.createElement("button");
  b.className = "btn small";
  b.textContent = label;
  b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    fn();
  });
  return b;
}

/* ---------- Actions ---------- */

async function copy(value) {
  await navigator.clipboard.writeText(value);
  toast("Đã copy value");
}

async function remove(e) {
  await run(pageRemove, [e.key]);
  await load();
  toast(`Đã xóa "${e.key}"`, "Hoàn tác", async () => {
    await run(pageSet, [e.key, e.value]);
    await load();
  });
}

function openModal(entry) {
  editingKey = entry ? entry.key : null;
  $("#modal-title").textContent = entry ? "Sửa item" : "Thêm item";
  $("#f-key").value = entry ? entry.key : "";
  $("#f-value").value = entry ? entry.value : "";
  $("#modal").classList.remove("hidden");
  (entry ? $("#f-value") : $("#f-key")).focus();
}
const closeModal = () => $("#modal").classList.add("hidden");

async function save() {
  const key = $("#f-key").value.trim();
  const value = $("#f-value").value;
  if (!key) {
    toast("Key không được để trống");
    return;
  }

  const exists = entries.some((e) => e.key === key);
  if (
    exists &&
    key !== editingKey &&
    !confirm(`Key "${key}" đã tồn tại. Ghi đè?`)
  )
    return;

  if (editingKey !== null && editingKey !== key)
    await run(pageRemove, [editingKey]);
  await run(pageSet, [key, value]);
  closeModal();
  await load();
  toast("Đã lưu");
}

function formatJSON() {
  try {
    $("#f-value").value = JSON.stringify(
      JSON.parse($("#f-value").value),
      null,
      2,
    );
  } catch {
    toast("Value không phải JSON hợp lệ");
  }
}

async function clearAll() {
  if (!entries.length) return;
  if (!confirm(`Xóa toàn bộ ${entries.length} items trong localStorage?`))
    return;
  const backup = entries;
  await run(pageClear);
  await load();
  toast("Đã xóa tất cả", "Hoàn tác", async () => {
    await run(pageImport, [
      Object.fromEntries(backup.map((e) => [e.key, e.value])),
    ]);
    await load();
  });
}

async function exportJSON() {
  const obj = Object.fromEntries(entries.map((e) => [e.key, e.value]));
  const host = new URL($("#origin").textContent).hostname || "localstorage";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }),
  );
  a.download = `localstorage-${host}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJSON(file) {
  try {
    const obj = JSON.parse(await file.text());
    if (obj === null || typeof obj !== "object" || Array.isArray(obj))
      throw new Error();
    await run(pageImport, [obj]);
    await load();
    toast(`Đã import ${Object.keys(obj).length} items`);
  } catch {
    toast('File JSON không hợp lệ (cần dạng { "key": "value" })');
  }
}

/* ---------- Init ---------- */

$("#search").addEventListener("input", render);
$("#btn-refresh").addEventListener("click", load);
$("#btn-add").addEventListener("click", () => openModal(null));
$("#btn-cancel").addEventListener("click", closeModal);
$("#btn-save").addEventListener("click", save);
$("#btn-format").addEventListener("click", formatJSON);
$("#btn-clear").addEventListener("click", clearAll);
$("#btn-export").addEventListener("click", exportJSON);
$("#btn-import").addEventListener("click", () => $("#file-input").click());
$("#file-input").addEventListener("change", (e) => {
  if (e.target.files[0]) importJSON(e.target.files[0]);
  e.target.value = "";
});
document.addEventListener("keydown", (e) => {
  if ($("#modal").classList.contains("hidden")) return;
  if (e.key === "Escape") closeModal();
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  load();
})();
