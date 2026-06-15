const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const karvonEnv = path.join(root, 'karvon.env');
const dotEnv = path.join(root, '.env');

require('dotenv').config({ path: karvonEnv });
if (fs.existsSync(dotEnv)) {
  require('dotenv').config({ path: dotEnv, override: true });
}
