/* eslint-disable @typescript-eslint/no-require-imports */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3000/social';
// Save to Repo Root (nhl-predictions-app) / DailyImages
const OUTPUT_DIR = path.join(__dirname, '../DailyImages');

(async () => {
    // 1. Setup Output Directory
    const today = new Date();
    // Format YYYY-MM-DD local or UTC? User said "current date".
    // I'll stick to local YYYY-MM-DD
    const dateStr = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');

    const dayDir = path.join(OUTPUT_DIR, dateStr);

    if (!fs.existsSync(dayDir)) {
        console.log(`Creating directory: ${dayDir}`);
        fs.mkdirSync(dayDir, { recursive: true });
    }

    console.log(`Starting Social Image Generator for ${dateStr}...`);
    console.log(`Target URL: ${BASE_URL}`);

    // 2. Launch Browser
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
    } catch (e) {
        console.error("Failed to launch puppeteer. Make sure it is installed (npm install puppeteer).");
        console.error(e);
        process.exit(1);
    }

    const page = await browser.newPage();

    // Set Viewport: 1080x1350, Scale 2
    await page.setViewport({
        width: 1080,
        height: 1350,
        deviceScaleFactor: 2
    });

    // 3. Generate Batches
    let batch = 0;
    const maxBatches = 10; // safety limit

    while (batch < maxBatches) {
        const url = `${BASE_URL}?batch=${batch}`;
        console.log(`Processing Batch ${batch}... (${url})`);

        try {
            // Navigate and wait for network idle to ensure data loaded
            const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

            if (!response.ok()) {
                console.error(`Failed to load page: ${response.status()} ${response.statusText()}`);
                break;
            }

            // Check for "No more games" indicator
            const content = await page.content();
            if (content.includes('No more games')) {
                console.log('End of games reached.');
                break;
            }

            // Wait for logo animation and fonts (added delay)
            await new Promise(r => setTimeout(r, 5000));

            // Screenshot
            const outFile = path.join(dayDir, `social_cards_batch_${batch + 1}.png`);
            await page.screenshot({ path: outFile }); // "fullPage" not needed as main div is fixed size

            console.log(`Saved: ${outFile}`);
            batch++;

        } catch (err) {
            console.error(`Error processing batch ${batch}:`, err);
            break;
        }
    }

    await browser.close();
    console.log('Social image generation complete.');
})();
