import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const table = process.env.SUPABASE_TABLE || 'areas_base_geojson';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Fetch in pages of 1000 rows with a stable order
const pageSize = 1000;
let from = 0;
let allRows = [];

while (true) {
  const to = from + pageSize - 1;

  const { data, error } = await supabase
    .from(table)
    .select('id, properties, geometry_geojson')
    .order('id', { ascending: true })
    .range(from, to);

  if (error) {
    console.error('Error querying Supabase:', error);
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

console.log(`Fetched ${allRows.length} rows, ${dedupedRows.length} unique ids from Supabase`);

const features = dedupedRows.map(row => {
  const p = row.properties || {};
  return {
    type: 'Feature',
    geometry: row.geometry_geojson,
    properties: {
      id: row.id,
      area_class: p.area_class ?? null,
      area_type: p.area_type ?? null,
      name: p.name ?? null
    }
  };
});

const featureCollection = {
  type: 'FeatureCollection',
  features
};

// Write to areas/areas.geojson
await fs.mkdir('areas', { recursive: true });
await fs.writeFile(
  'areas/areas.geojson',
  JSON.stringify(featureCollection),
  'utf8'
);

console.log(`Wrote ${features.length} features to areas/areas.geojson`);
