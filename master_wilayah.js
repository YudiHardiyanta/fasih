const puppeteer = require("puppeteer");
const Survey = require("./models/survey");
const RegionGroup = require("./models/regionGroup");
const Level1 = require("./models/Level1");
const Level2 = require("./models/Level2");
const Level3 = require("./models/Level3");
const Level4 = require("./models/Level4");
const Level5 = require("./models/Level5");
const Level6 = require("./models/Level6");
const sequelize = require("./database");

require("dotenv").config();

async function crawl_master_wilayah() {
    await sequelize.authenticate();
    console.log("Database connected");
    await sequelize.sync();

    const surveyId = process.env.SURVEY_ID;

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // 🔐 LOGIN
    await page.goto("https://fasih-sm.bps.go.id/oauth2/authorization/ics", {
        waitUntil: "networkidle2"
    });

    await page.type("#username", process.env.USERNAME_COMMUNITY);
    await page.type("#password", process.env.PASSWORD_COMMUNITY);
    await page.click("#kc-login");
    await page.waitForNavigation();

    // 📊 MASUK HALAMAN SURVEY
    await page.goto(
        "https://fasih-sm.bps.go.id/survey-collection/collect/" + surveyId,
        { waitUntil: "networkidle2" }
    );

    console.log("Survey INFO");

    const survey = await page.evaluate(async (surveyId) => {
        const res = await fetch(
            "https://fasih-sm.bps.go.id/survey/api/v1/surveys/" + surveyId,
            {
                method: "GET",
                credentials: "include",
                headers: { accept: "application/json" }
            }
        );
        return await res.json();
    }, surveyId);

    await Survey.upsert(survey.data);

    console.log("Download Master Wilayah");

    const groupId = survey.data.regionGroupId;

    // 📍 REGION METADATA
    let region_level = await page.evaluate(async (groupId) => {
        const res = await fetch(
            "https://fasih-sm.bps.go.id/region/api/v1/region-metadata?id=" + groupId,
            {
                method: "GET",
                credentials: "include",
                headers: { accept: "application/json" }
            }
        );
        return await res.json();
    }, groupId);

    await RegionGroup.upsert(region_level.data);

    const level_count = region_level.data.levelCount;

    // 🔥 INIT STRUKTUR LEVEL
    for (let i = 0; i < level_count; i++) {
        if (!region_level.data.level[i]) {
            region_level.data.level[i] = {};
        }
        region_level.data.level[i].data = [];
    }

    let current_level = 1;

    while (current_level <= level_count) {
        console.log("download level " + current_level);

        // ================= LEVEL 1 =================
        if (current_level === 1) {
            const level = await page.evaluate(async (groupId) => {
                const res = await fetch(
                    "https://fasih-sm.bps.go.id/region/api/v1/region/level1?groupId=" + groupId,
                    {
                        method: "GET",
                        credentials: "include",
                        headers: { accept: "application/json" }
                    }
                );
                return await res.json();
            }, groupId);

            const filtered = [];

            for (const element of level.data || []) {
                if (element.fullCode == process.env.FULLCODE_REGION_1) {
                    filtered.push(element);
                }
            }

            region_level.data.level[0].data = filtered;

            await Level1.bulkCreate(filtered, {
                updateOnDuplicate: ["id"]
            });
        }

        // ================= LEVEL > 1 =================
        else {
            const prevLevel = region_level.data.level[current_level - 2];
            const currLevel = region_level.data.level[current_level - 1];

            if (!prevLevel || !Array.isArray(prevLevel.data)) {
                console.log("Level sebelumnya kosong, stop.");
                break;
            }

            currLevel.data = [];

            for (const element of prevLevel.data) {
                const params = {
                    groupId: groupId
                };

                const key = `level${current_level - 1}Id`;
                params[key] = element.id;

                const level = await page.evaluate(
                    async ({ params, current_level }) => {
                        const key = `level${current_level - 1}Id`;

                        const url = `https://fasih-sm.bps.go.id/region/api/v1/region/level${current_level}?groupId=${params.groupId}&${key}=${params[key]}`;

                        const res = await fetch(url, {
                            method: "GET",
                            credentials: "include",
                            headers: { accept: "application/json" }
                        });

                        return await res.json();
                    },
                    { params, current_level }
                );

                currLevel.data.push(...(level.data || []));

                // 🔥 SIMPAN KE DB
                if (current_level === 2) {
                    await Level2.bulkCreate(level.data, { updateOnDuplicate: ["id"] });
                }
                if (current_level === 3) {
                    await Level3.bulkCreate(level.data, { updateOnDuplicate: ["id"] });
                }
                if (current_level === 4) {
                    await Level4.bulkCreate(level.data, { updateOnDuplicate: ["id"] });
                }
                if (current_level === 5) {
                    await Level5.bulkCreate(level.data, { updateOnDuplicate: ["id"] });
                }
                if (current_level === 6) {
                    await Level6.bulkCreate(level.data, { updateOnDuplicate: ["id"] });
                }
            }
        }
        current_level++;
    }

    console.log("Selesai download semua level");
    await browser.close();
}

crawl_master_wilayah();