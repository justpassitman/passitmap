require('dotenv').config();
const fs = require('fs');
const apiKey = process.env.ORS_API_KEY;
if (!apiKey) {
    console.error('Error: ORS_API_KEY environment variable not set');
    process.exit(1);
}
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('API_KEY_PLACEHOLDER', apiKey);
// Ensure the dist folder exists
if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
}
fs.writeFileSync('dist/index.html', html);
console.log('Build complete. Output saved to dist/index.html');
