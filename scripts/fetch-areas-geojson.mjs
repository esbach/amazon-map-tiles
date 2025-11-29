// scripts/fetch-areas-geojson.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const table = process.env.SUPABASE_TABLE || 'areas_base_geojson';

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Match the view you created: areas_base_geojson
const { data, error } = await supabase
  .from(table)
  .select('id, area_class, area_type, name, geometry_geojson');

if (error) {
  console.error('Error querying Supabase:', error);
  process.exit(1);
}

const features = (data || []).map(row => ({
  type: 'Feature',
  geometry: row.geometry_geojson,
  properties: {
    id: row.id,
    area_class: row.area_class,
    area_type: row.area_type,
    name: row.name
  }
}));

const featureCollection = {
  type: 'FeatureCollection',
  features
};

await fs.mkdir('data', { recursive: true });
await fs.writeFile(
  'data/areas_base.geojson',
  JSON.stringify(featureCollection),
  'utf8'
);

console.log(`Wrote ${features.length} features to data/areas_base.geojson`);
