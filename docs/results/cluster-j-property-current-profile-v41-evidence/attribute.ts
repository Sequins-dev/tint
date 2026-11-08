import { readFileSync, writeFileSync } from 'node:fs';
import { attributeNativeSample } from '../../tools/native-sample-attribution.ts';
for (const stem of ['native', 'native-late']) {
  const result = attributeNativeSample(readFileSync(`.tint-bootstrap/j-property-current-profile-v41/${stem}.sample.txt`, 'utf8'));
  writeFileSync(`.tint-bootstrap/j-property-current-profile-v41/${stem}-exclusive.json`, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ sample: stem, samples: result.samples, top: result.leafGroups.slice(0, 7) }));
}
