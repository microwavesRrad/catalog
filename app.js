import * as maplibregl from "https://unpkg.com/maplibre-gl@^6.6.0/dist/maplibre-gl.mjs";

const STORAGE_KEY = "met-a-cat-sightings-v1";
const DEFAULT_CENTER = [-105.2705, 40.015];
const DEFAULT_ZOOM = 12.8;
const PRIVACY_GRID = 0.0015;

const PMS309 = "#003B49";
const PMS309_MID = "#557981";
const PMS309_SOFT = "#9CB3B7";
const PMS309_PALE = "#DCE7E8";
const PAPER = "#F7FAF9";
const PAPER_2 = "#EDF4F4";

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: DEFAULT_CENTER,
  zoom: DEFAULT_ZOOM,
  attributionControl: false,
  pitchWithRotate: false,
  dragRotate: false,
  touchPitch: false
});

map.addControl(
  new maplibregl.NavigationControl({
    showCompass: false,
    visualizePitch: false
  }),
  "bottom-right"
);

map.addControl(
  new maplibregl.AttributionControl({ compact: true }),
  "bottom-left"
);

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
let mapReady = false;

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
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
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

function displayName(s) {
  return (s.name || "").trim() || "unnamed neighborhood cat";
}

function dateLabel(iso) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
  }).format(new Date(iso));
}

function setPaintIfPossible(layerId, property, value) {
  try {
    map.setPaintProperty(layerId, property, value);
  } catch {
    // Different upstream styles support slightly different paint properties.
  }
}

function hideLayerIfPossible(layerId) {
  try {
    map.setLayoutProperty(layerId, "visibility", "none");
  } catch {}
}

function simplifyBasemap() {
  const style = map.getStyle();
  if (!style?.layers) return;

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();

    // Remove visual clutter while keeping streets and place labels.
    if (
      id.includes("poi") ||
      id.includes("transit") ||
      id.includes("airport") ||
      id.includes("aeroway") ||
      id.includes("housenumber")
    ) {
      hideLayerIfPossible(layer.id);
      continue;
    }

    if (layer.type === "background") {
      setPaintIfPossible(layer.id, "background-color", PAPER);
    }

    if (layer.type === "fill") {
      if (id.includes("water")) {
        setPaintIfPossible(layer.id, "fill-color", PMS309_PALE);
        setPaintIfPossible(layer.id, "fill-opacity", 0.78);
      } else if (
        id.includes("park") ||
        id.includes("landcover") ||
        id.includes("landuse") ||
        id.includes("wood")
      ) {
        setPaintIfPossible(layer.id, "fill-color", "#EFF4F1");
        setPaintIfPossible(layer.id, "fill-opacity", 0.76);
      } else if (id.includes("building")) {
        setPaintIfPossible(layer.id, "fill-color", "#E7EEEE");
        setPaintIfPossible(layer.id, "fill-opacity", 0.72);
      } else {
        setPaintIfPossible(layer.id, "fill-color", PAPER);
        setPaintIfPossible(layer.id, "fill-opacity", 0.82);
      }
    }

    if (layer.type === "line") {
      if (id.includes("water")) {
        setPaintIfPossible(layer.id, "line-color", PMS309_SOFT);
        setPaintIfPossible(layer.id, "line-opacity", 0.65);
      } else if (
        id.includes("road") ||
        id.includes("street") ||
        id.includes("highway") ||
        id.includes("transport")
      ) {
        setPaintIfPossible(layer.id, "line-color", "#819CA2");
        setPaintIfPossible(layer.id, "line-opacity", 0.62);
      } else {
        setPaintIfPossible(layer.id, "line-color", PMS309_SOFT);
        setPaintIfPossible(layer.id, "line-opacity", 0.42);
      }
    }

    if (layer.type === "symbol") {
      setPaintIfPossible(layer.id, "text-color", PMS309_MID);
      setPaintIfPossible(layer.id, "text-halo-color", PAPER);
      setPaintIfPossible(layer.id, "text-halo-width", 1.25);
      setPaintIfPossible(layer.id, "icon-opacity", 0.45);
    }
  }
}

function makeMarkerElement(pending = false) {
  const el = document.createElement("div");
  el.className = `map-cat-marker${pending ? " pending" : ""}`;
  el.setAttribute("aria-label", pending ? "Selected approximate location" : "Cat sighting");
  return el;
}

function addMapMarker(s) {
  if (!mapReady) return;

  const el = makeMarkerElement(false);
  const popup = new maplibregl.Popup({
    offset: 16,
    closeButton: true,
    closeOnClick: true
  }).setHTML(`
    <div class="popup-cat">
      <strong>${escapeHtml(displayName(s))}</strong>
      <small>${escapeHtml(s.color)} · ${escapeHtml(s.personality)}</small>
      ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ""}
    </div>
  `);

  const marker = new maplibregl.Marker({
    element: el,
    anchor: "center"
  })
    .setLngLat([s.lng, s.lat])
    .setPopup(popup)
    .addTo(map);

  el.addEventListener("click", event => {
    event.stopPropagation();
    highlightCard(s.id);
  });

  markerById.set(s.id, marker);
}

function clearMapMarkers() {
  markerById.forEach(marker => marker.remove());
  markerById.clear();
}

function renderList() {
  catList.innerHTML = "";
  catCount.textContent = sightings.length;
  emptyState.hidden = sightings.length > 0;

  [...sightings]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach(s => {
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

      const count = 1 + (s.confirmations || 0);
      seenCount.textContent = `${count} sighting${count === 1 ? "" : "s"}`;

      if (s.photo) {
        img.src = s.photo;
        img.alt = `Photo of ${displayName(s)}`;
        img.classList.add("is-visible");
        placeholder.hidden = true;
      }

      main.addEventListener("click", () => {
        if (!mapReady) return;
        map.easeTo({
          center: [s.lng, s.lat],
          zoom: Math.max(map.getZoom(), 15),
          duration: 650
        });
        markerById.get(s.id)?.togglePopup();
      });

      confirm.addEventListener("click", () => {
        s.confirmations = (s.confirmations || 0) + 1;
        saveSightings();
        renderAll();
      });

      catList.appendChild(node);
    });
}

function renderMarkers() {
  if (!mapReady) return;
  clearMapMarkers();
  sightings.forEach(addMapMarker);
}

function renderAll() {
  renderList();
  renderMarkers();
}

function highlightCard(id) {
  const selector = `.cat-card[data-id="${CSS.escape(id)}"]`;
  document.querySelector(selector)?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function beginSighting() {
  isChoosingLocation = true;
  addButton.textContent = "click a spot on the map…";
  addButton.disabled = true;
  map.getCanvas().style.cursor = "crosshair";
}

function stopChoosingLocation() {
  isChoosingLocation = false;
  addButton.textContent = "+ met a cat";
  addButton.disabled = false;
  if (mapReady) map.getCanvas().style.cursor = "";
}

function setPendingLocation(lat, lng) {
  const fuzzy = approximate(lat, lng);

  latInput.value = fuzzy.lat;
  lngInput.value = fuzzy.lng;
  locationReadout.textContent =
    "Approximate spot selected. The saved point has been intentionally fuzzed for privacy.";

  pendingMarker?.remove();
  pendingMarker = new maplibregl.Marker({
    element: makeMarkerElement(true),
    anchor: "center"
  })
    .setLngLat([fuzzy.lng, fuzzy.lat])
    .addTo(map);

  stopChoosingLocation();
  sightingDialog.showModal();
}

map.on("load", () => {
  mapReady = true;
  simplifyBasemap();
  renderMarkers();
});

map.on("styledata", () => {
  // The remote vector style may finish loading in phases.
  if (mapReady) simplifyBasemap();
});

map.on("click", event => {
  if (!isChoosingLocation) return;
  setPendingLocation(event.lngLat.lat, event.lngLat.lng);
});

window.addEventListener("resize", () => {
  if (mapReady) map.resize();
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
      map.easeTo({
        center: [pos.coords.longitude, pos.coords.latitude],
        zoom: 15.5,
        duration: 700
      });
      beginSighting();
    },
    () => {
      locateButton.textContent = "use my location";
      alert("Location wasn't available. You can still place a sighting manually.");
    },
    {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 300000
    }
  );
});

aboutButton.addEventListener("click", () => aboutDialog.showModal());

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    button.closest("dialog")?.close();
  });
});

sightingDialog.addEventListener("close", () => {
  pendingMarker?.remove();
  pendingMarker = null;
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

  if (photoFile && photoFile.size > 2_000_000) {
    alert("For this prototype, please use a photo under 2 MB.");
    return;
  }

  const photo = await fileToDataUrl(photoFile);

  const sighting = {
    id: crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
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
  renderAll();

  if (mapReady) {
    map.easeTo({
      center: [sighting.lng, sighting.lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 650
    });

    window.setTimeout(() => markerById.get(sighting.id)?.togglePopup(), 450);
  }
});

renderList();
