/**
 * Geocoding (Nominatim) and routing (OSRM) for live ambulance tracking.
 * In-memory cache for geocode results to respect Nominatim usage policy (1 req/s).
 */

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const OSRM_BASE = 'https://router.project-osrm.org';

// In-memory cache: key = normalized address string, value = { lat, lng, address, cachedAt }
const geocodeCache = new Map();
const GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function normalizeAddress(q) {
  if (typeof q !== 'string') return '';
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function getCachedGeocode(address) {
  const key = normalizeAddress(address);
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > GEOCODE_CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedGeocode(address, lat, lng, displayName) {
  const key = normalizeAddress(address);
  geocodeCache.set(key, {
    lat,
    lng,
    address: displayName || address,
    cachedAt: Date.now(),
  });
}

/**
 * POST /api/geocode
 * Body: { address: string }
 * Returns: { lat, lng, address, cached?: boolean }
 */
export async function geocode(req, res) {
  try {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address is required (string)' });
    }

    const cached = getCachedGeocode(address);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json({
        lat: cached.lat,
        lng: cached.lng,
        address: cached.address,
        cached: true,
      });
    }
    res.set('X-Cache', 'MISS');

    const q = encodeURIComponent(address.trim());
    const url = `${NOMINATIM_BASE}/search?q=${q}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'HMS-Ambulance-Tracking/1.0' },
    });

    if (!resp.ok) {
      return res.status(502).json({ error: 'Geocoding service unavailable' });
    }

    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'Address not found' });
    }

    const first = data[0];
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lon);
    const displayName = first.display_name || address;

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      return res.status(502).json({ error: 'Invalid geocoding response' });
    }

    setCachedGeocode(address, lat, lng, displayName);

    res.json({
      lat,
      lng,
      address: displayName,
      cached: false,
    });
    return;
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/routing/calculate
 * Body: { from: { lat, lng } | { address }, to: { lat, lng } | { address } }
 * If address is provided, geocodes first (uses cache).
 * Returns: { path: [[lat,lng],...], duration_seconds, distance_meters }
 */
export async function calculateRoute(req, res) {
  try {
    const { from: fromInput, to: toInput } = req.body || {};
    if (!fromInput || !toInput) {
      return res.status(400).json({ error: 'from and to are required' });
    }

    let fromLat = fromInput.lat;
    let fromLng = fromInput.lng;
    let toLat = toInput.lat;
    let toLng = toInput.lng;

    if (fromInput.address != null) {
      const cached = getCachedGeocode(fromInput.address);
      if (cached) {
        fromLat = cached.lat;
        fromLng = cached.lng;
      } else {
        const q = encodeURIComponent(String(fromInput.address).trim());
        const url = `${NOMINATIM_BASE}/search?q=${q}&format=json&limit=1`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'HMS-Ambulance-Tracking/1.0' },
        });
        if (!resp.ok) return res.status(502).json({ error: 'Geocoding (from) failed' });
        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) return res.status(404).json({ error: 'From address not found' });
        fromLat = parseFloat(data[0].lat);
        fromLng = parseFloat(data[0].lon);
        setCachedGeocode(fromInput.address, fromLat, fromLng, data[0].display_name);
      }
    }

    if (toInput.address != null) {
      const cached = getCachedGeocode(toInput.address);
      if (cached) {
        toLat = cached.lat;
        toLng = cached.lng;
      } else {
        const q = encodeURIComponent(String(toInput.address).trim());
        const url = `${NOMINATIM_BASE}/search?q=${q}&format=json&limit=1`;
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'HMS-Ambulance-Tracking/1.0' },
        });
        if (!resp.ok) return res.status(502).json({ error: 'Geocoding (to) failed' });
        const data = await resp.json();
        if (!Array.isArray(data) || data.length === 0) return res.status(404).json({ error: 'To address not found' });
        toLat = parseFloat(data[0].lat);
        toLng = parseFloat(data[0].lon);
        setCachedGeocode(toInput.address, toLat, toLng, data[0].display_name);
      }
    }

    if (
      typeof fromLat !== 'number' || typeof fromLng !== 'number' ||
      typeof toLat !== 'number' || typeof toLng !== 'number' ||
      Number.isNaN(fromLat) || Number.isNaN(fromLng) || Number.isNaN(toLat) || Number.isNaN(toLng)
    ) {
      return res.status(400).json({ error: 'Valid from/to coordinates or addresses required' });
    }

    // OSRM: coordinates as lng,lat
    const coords = `${fromLng},${fromLat};${toLng},${toLat}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'HMS-Ambulance-Tracking/1.0' } });

    if (!resp.ok) {
      return res.status(502).json({ error: 'Routing service unavailable' });
    }

    const data = await resp.json();
    if (data.code !== 'Ok' || !data.routes?.length) {
      return res.status(404).json({ error: 'No route found' });
    }

    const route = data.routes[0];
    const geometry = route.geometry;
    // GeoJSON coordinates are [lng, lat]; we return [lat, lng] for Leaflet
    const path = (geometry?.coordinates || []).map(([lng, lat]) => [lat, lng]);

    res.json({
      path,
      duration_seconds: Math.round(route.duration || 0),
      distance_meters: Math.round(route.distance || 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
