
const STORAGE_KEY = "met-a-cat-sightings-v1";

// Boulder is only the initial camera position. The app does not save
// the visitor's actual location unless they explicitly add a sighting.
const DEFAULT_CENTER = [40.015, -105.2705];
const DEFAULT_ZOOM = 13;

// ~0.0015 degrees is roughly 100–170 m around Boulder.
// We add randomized jitter within that cell so saved coordinates
// are intentionally approximate rather than a precise address.
const PRIVACY_GRID = 0.0015;

const map = L.map("map", {
  zoomControl: true
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

// Recalculate the map only when the actual browser viewport changes.
window.addEventListener("resize", () => {
  window.setTimeout(() => map.invalidateSize(false), 100);
});

const sightingDialog = document.querySelector("#sightingDialog");
const aboutDialog = document.querySelector("#aboutDialog");
const addButton = document.querySelector("#addSightingButton");
const locateButton = document.querySelector("#locateButton");
const aboutButton = document.querySelector("#aboutButton");
const form = document.querySelector("#sightingForm");
const latInput = document.querySelector("#lat");
const lngInput = document.querySelector("#lng");
const locationReadout = document.querySelector("#locationReadout");
const catList = document.querySelector("#catList");
const emptyState = document.querySelector("#emptyState");
const catCount = document.querySelector("#catCount");
const template = document.querySelector("#catCardTemplate");

let sightings = loadSightings();
let markerById = new Map();
let pendingMarker = null;
let isChoosingLocation = false;

function loadSightings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSightings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sightings));
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[ch]));
}

function fuzzyCoordinate(value) {
  const base = Math.round(value / PRIVACY_GRID) * PRIVACY_GRID;
  const jitter = (Math.random() - 0.5) * PRIVACY_GRID * 0.7;
  return Number((base + jitter).toFixed(5));
}

function approximate(lat, lng) {
  return { lat: fuzzyCoordinate(lat), lng: fuzzyCoordinate(lng) };
}

function markerIcon(pending = false) {
  return L.divIcon({
    className: "",
    html: `<div class="cat-marker ${pending ? "pending-marker" : ""}"><span>猫</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -36]
  });
}

function displayName(s) {
  return (s.name || "").trim() || "unnamed neighborhood cat";
}

function dateLabel(iso) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(iso));
}

function addMapMarker(s) {
  const marker = L.marker([s.lat, s.lng], { icon: markerIcon(false) }).addTo(map);
  marker.bindPopup(`
    <div class="popup-cat">
      <strong>${escapeHtml(displayName(s))}</strong>
      <small>${escapeHtml(s.color)} · ${escapeHtml(s.personality)}</small>
      ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ""}
    </div>
  `);
  marker.on("click", () => highlightCard(s.id));
  markerById.set(s.id, marker);
}

function clearMapMarkers() {
  markerById.forEach(marker => map.removeLayer(marker));
  markerById.clear();
}

function render() {
  clearMapMarkers();
  catList.innerHTML = "";
  catCount.textContent = sightings.length;
  emptyState.hidden = sightings.length > 0;

  [...sightings]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach(s => {
      addMapMarker(s);

      const node = template.content.cloneNode(true);
      const article = node.querySelector(".cat-card");
      const main = node.querySelector(".cat-card-main");
      const title = node.querySelector("h3");
      const time = node.querySelector("time");
      const tags = node.querySelector(".tags");
      const note = node.querySelector(".note");
      const img = node.querySelector(".cat-thumb");
      const placeholder = node.querySelector(".cat-thumb-placeholder");
      const seenCount = node.querySelector(".seen-count");
      const confirm = node.querySelector(".confirm-button");

      article.dataset.id = s.id;
      title.textContent = displayName(s);
      time.textContent = dateLabel(s.createdAt);
      time.dateTime = s.createdAt;
      tags.textContent = `${s.color} · ${s.personality}`;
      note.textContent = s.note || "No field notes.";
      seenCount.textContent = `${1 + (s.confirmations || 0)} sighting${1 + (s.confirmations || 0) === 1 ? "" : "s"}`;

      if (s.photo) {
        img.src = s.photo;
        img.alt = `Photo of ${displayName(s)}`;
        img.classList.add("is-visible");
        placeholder.hidden = true;
      }

      main.addEventListener("click", () => {
        map.setView([s.lat, s.lng], Math.max(map.getZoom(), 16), { animate: true });
        markerById.get(s.id)?.openPopup();
      });

      confirm.addEventListener("click", () => {
        s.confirmations = (s.confirmations || 0) + 1;
        saveSightings();
        render();
      });

      catList.appendChild(node);
    });
}

function highlightCard(id) {
  const el = document.querySelector(`.cat-card[data-id="${CSS.escape(id)}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function beginSighting() {
  isChoosingLocation = true;
  addButton.textContent = "click a spot on the map…";
  addButton.disabled = true;
  map.getContainer().style.cursor = "crosshair";
}

function stopChoosingLocation() {
  isChoosingLocation = false;
  addButton.textContent = "+ met a cat";
  addButton.disabled = false;
  map.getContainer().style.cursor = "";
}

function setPendingLocation(lat, lng) {
  const fuzzy = approximate(lat, lng);

  latInput.value = fuzzy.lat;
  lngInput.value = fuzzy.lng;
  locationReadout.textContent =
    "Approximate spot selected. The saved point has been intentionally fuzzed for privacy.";

  if (pendingMarker) map.removeLayer(pendingMarker);
  pendingMarker = L.marker([fuzzy.lat, fuzzy.lng], {
    icon: markerIcon(true)
  }).addTo(map);

  stopChoosingLocation();
  sightingDialog.showModal();
}

map.on("click", e => {
  if (!isChoosingLocation) return;
  setPendingLocation(e.latlng.lat, e.latlng.lng);
});

addButton.addEventListener("click", beginSighting);

locateButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("This browser does not support location access.");
    return;
  }

  locateButton.textContent = "finding you…";

  navigator.geolocation.getCurrentPosition(
    pos => {
      locateButton.textContent = "use my location";
      map.setView([pos.coords.latitude, pos.coords.longitude], 16, { animate: true });
      beginSighting();
    },
    () => {
      locateButton.textContent = "use my location";
      alert("Location wasn't available. You can still place a sighting manually.");
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
});

aboutButton.addEventListener("click", () => aboutDialog.showModal());

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    button.closest("dialog")?.close();
  });
});

sightingDialog.addEventListener("close", () => {
  if (pendingMarker) {
    map.removeLayer(pendingMarker);
    pendingMarker = null;
  }
  stopChoosingLocation();
  locationReadout.textContent =
    "Click somewhere on the map to choose an approximate location.";
  latInput.value = "";
  lngInput.value = "";
});

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!latInput.value || !lngInput.value) {
    locationReadout.textContent = "Choose a location on the map first.";
    return;
  }

  const photoFile = document.querySelector("#photo").files[0];

  // A small localStorage prototype: large images can exceed browser quota,
  // so we reject unusually large originals and keep the behavior predictable.
  if (photoFile && photoFile.size > 2_000_000) {
    alert("For this prototype, please use a photo under 2 MB.");
    return;
  }

  const photo = await fileToDataUrl(photoFile);

  const sighting = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    name: document.querySelector("#catName").value.trim(),
    color: document.querySelector("#catColor").value,
    personality: document.querySelector("#personality").value,
    note: document.querySelector("#note").value.trim(),
    photo,
    lat: Number(latInput.value),
    lng: Number(lngInput.value),
    confirmations: 0,
    createdAt: new Date().toISOString()
  };

  sightings.push(sighting);

  try {
    saveSightings();
  } catch {
    alert("The browser ran out of local storage. Try a smaller photo or remove old prototype data.");
    sightings.pop();
    return;
  }

  form.reset();
  sightingDialog.close();
  render();

  map.setView([sighting.lat, sighting.lng], Math.max(map.getZoom(), 16), { animate: true });
  setTimeout(() => markerById.get(sighting.id)?.openPopup(), 300);
});

render();
