import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

async function captureSocialPost() {
    const url = 'http://localhost:3000/social';
    const outputDir = path.join(process.cwd(), 'SocialImages');
    const outputPath = path.join(outputDir, `social_post_${new Date().toISOString().split('T')[0]}.png`);

    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`🚀 Launching browser to capture ${url}...`);
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();

        // Set viewport to the exact dimensions of the social graphic
        await page.setViewport({
            width: 1179,
            height: 1350,
            deviceScaleFactor: 2, // High DPI
        });

        console.log('⏳ Navigating to social page...');
        await page.goto(url, { waitUntil: 'networkidle0' });

        // Wait a small amount of time for any client-side animations to settle if needed
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`📸 Taking screenshot...`);
        await page.screenshot({
            path: outputPath,
            fullPage: false,
            clip: {
                x: 0,
                y: 0,
                width: 1179,
                height: 1350
            }
        });

        console.log(`✅ Success! Image saved to: ${outputPath}`);
    } catch (error) {
        console.error('❌ Error capturing screenshot:', error);
    } finally {
        await browser.close();
    }
}

captureSocialPost();
