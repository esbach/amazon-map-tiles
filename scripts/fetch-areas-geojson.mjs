import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';

// Two tilesets come out of Supabase, from two views that partition areas_base.
//
// Complementary instruments (Bosque Protector, Patrimonio Forestal, Programa
// Socio Bosque, Zona Intangible, Humedal Ramsar, ...) blanket the areas they
// complement, so the website keeps them out of the default map and only fetches
// their archive once a reader switches one of the classes on in the legend.
// Giving them their own archive is what makes that possible, and keeps the
// primary one - the map everybody loads - small.
//
// The split lives in the views, not here: areas_base_geojson already excludes
// the complementary classes and areas_complementary_geojson holds only those.
const DATASETS = {
  areas: {
    view: process.env.SUPABASE_TABLE || 'areas_base_geojson',
    out: 'areas/areas.geojson',
    // Carried into the tiles, and no more: the website resolves everything else
    // per area from Supabase by id.
    columns: ['id', 'area_type', 'area_class', 'country'],
  },
  complementary: {
    view: 'areas_complementary_geojson',
    out: 'areas/complementary.geojson',
    // area_designation rides along here because these classes hold a dozen
    // different instruments under one colour, so the specific designation is
    // the only way a reader can tell them apart on the map.
    columns: ['id', 'area_type', 'area_class', 'area_designation', 'country'],
  },
};

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(DATASETS);

for (const name of names) {
  if (!DATASETS[name]) {
    console.error(`Unknown dataset "${name}". Known: ${Object.keys(DATASETS).join(', ')}`);
    process.exit(1);
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

// A page carries full-resolution geometry, so it is big: 250 rows is roughly
// 15 MB of JSON. Larger pages are what made this step fragile - a 1000-row page
// was ~60 MB and took ~25 s to come back, long enough for Supabase's gateway to
// drop the connection now and then (Cloudflare 520/521).
const PAGE_SIZE = 250;

// Waits between attempts at one page. A gateway blip or a statement timeout is
// usually gone within a minute or two, and a failed run otherwise leaves the
// map stale until somebody notices, so it is worth waiting a few minutes.
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Supabase's gateway answers a failed request with a whole Cloudflare HTML
// page, which supabase-js hands back as the error message. Keep the log to the
// page's title instead of two hundred lines of markup.
function describeError(error) {
  const message = String(error?.message ?? error);
  const title = message.match(/<title>([^<]*)<\/title>/i);
  const summary = title ? title[1].trim() : message.slice(0, 300);
  return error?.code ? `${error.code}: ${summary}` : summary;
}

// One page, keyed on the last id of the page before it rather than on an
// offset. With an offset Postgres still converts every skipped row's geometry
// to GeoJSON before discarding it, so each page cost more than the one before
// and the last ones ran closest to the statement timeout.
async function fetchPage(view, select, afterId) {
  for (let attempt = 0; ; attempt++) {
    let error;
    try {
      let query = supabase
        .from(view)
        .select(select)
        .order('id', { ascending: true })
        .limit(PAGE_SIZE);
      if (afterId != null) query = query.gt('id', afterId);

      const result = await query;
      if (!result.error) return result.data ?? [];
      error = result.error;
    } catch (thrown) {
      error = thrown;
    }

    const where = afterId == null ? 'first page' : `page after ${afterId}`;
    if (attempt >= RETRY_DELAYS_MS.length) {
      console.error(`Error querying ${view} (${where}), giving up after ${attempt + 1} attempts: ${describeError(error)}`);
      process.exit(1);
    }

    const delay = RETRY_DELAYS_MS[attempt];
    console.warn(`${view} (${where}) failed: ${describeError(error)} - retrying in ${delay / 1000}s`);
    await sleep(delay);
  }
}

async function fetchDataset({ view, out, columns }) {
  const select = [...columns, 'geometry'].join(', ');

  let afterId = null;
  let allRows = [];

  while (true) {
    const data = await fetchPage(view, select, afterId);

    if (data.length === 0) {
      break; // no more rows
    }

    allRows.push(...data);

    if (data.length < PAGE_SIZE) {
      break; // last page
    }

    afterId = data[data.length - 1].id;
  }

  // 🔹 Deduplicate by id just in case
  const byId = new Map();
  for (const row of allRows) {
    if (row.id == null) continue;
    byId.set(row.id, row);
  }
  const dedupedRows = Array.from(byId.values());

  console.log(`${view}: fetched ${allRows.length} rows, ${dedupedRows.length} unique ids`);

  const features = dedupedRows.map(row => {
    const properties = {};
    for (const column of columns) {
      properties[column] = row[column] ?? null;
    }
    return {
      type: 'Feature',
      geometry: row.geometry,
      properties,
    };
  });

  const featureCollection = {
    type: 'FeatureCollection',
    features,
  };

  await fs.mkdir('areas', { recursive: true });
  await fs.writeFile(out, JSON.stringify(featureCollection), 'utf8');

  console.log(`Wrote ${features.length} features to ${out}`);

  // An empty archive would break the website's source, and silently: the map
  // would just stop drawing that class. Far better to fail the build here.
  if (features.length === 0) {
    console.error(`${view} returned no rows - refusing to build an empty tileset`);
    process.exit(1);
  }
}

for (const name of names) {
  await fetchDataset(DATASETS[name]);
}
