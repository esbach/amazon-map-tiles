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

async function fetchDataset({ view, out, columns }) {
  const select = [...columns, 'geometry'].join(', ');

  // Fetch in pages of 1000 rows with a stable order
  const pageSize = 1000;
  let from = 0;
  let allRows = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from(view)
      .select(select)
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      console.error(`Error querying ${view}:`, error);
      process.exit(1);
    }

    if (!data || data.length === 0) {
      break; // no more rows
    }

    allRows.push(...data);

    if (data.length < pageSize) {
      break; // last page
    }

    from += pageSize;
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
