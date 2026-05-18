const puppeteer = require("puppeteer");
const Survey = require("./models/survey");
const RegionGroup = require("./models/regionGroup");
const Assignment = require("./models/assignment");
const Last = require("./models/Last");
const Unduh = require("./models/unduh");
const sequelize = require("./database");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

async function doLogin(page) {
    console.log("🔐 Login ulang...");

    await page.goto("https://fasih-sm.bps.go.id/oauth2/authorization/ics", {
        waitUntil: "networkidle2"
    });

    await page.type("#username", process.env.USERNAME_COMMUNITY, { delay: 50 });
    await page.type("#password", process.env.PASSWORD_COMMUNITY, { delay: 50 });
    await page.click("#kc-login");

    await page.waitForNavigation({ waitUntil: "networkidle2" });

    console.log("✅ Login berhasil");
}

async function fetchWithRetry(page, body) {
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const cookies = await page.cookies();
            const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");
            const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;

            const result = await page.evaluate(async (xsrfToken, body) => {
                const res = await fetch(
                    "https://fasih-sm.bps.go.id/analytic/api/v2/assignment/datatable-all-user-survey-periode",
                    {
                        method: "POST",
                        credentials: "include",
                        headers: {
                            "accept": "application/json",
                            "content-type": "application/json",
                            "x-xsrf-token": xsrfToken
                        },
                        body: JSON.stringify(body)
                    }
                );

                if (!res.ok) {
                    throw new Error("HTTP " + res.status);
                }

                return await res.json();
            }, xsrfToken, body);

            // validasi session
            if (!result || !result.searchData) {
                throw new Error("Session expired / data invalid");
            }

            return result;

        } catch (err) {
            console.log(`❌ Attempt ${attempt} gagal:`, err.message);

            if (attempt === 1) {
                await doLogin(page);
            } else {
                throw err;
            }
        }
    }
}

async function crawl() {
    await sequelize.authenticate();
    console.log("Database connected");
    await sequelize.sync();
    const now = new Date();
    await Unduh.bulkCreate([{"id" : "1", "start": now, "finish": null}], {
        updateOnDuplicate: ["start", "finish"]
    });

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();

    // 🔐 LOGIN AWAL
    await doLogin(page);

    const region = await RegionGroup.findOne();
    const survey = await Survey.findOne();

    let survey_periode_id = survey.surveyPeriods[0].id;
    if (process.env.SURVEY_PERIOD_ID) {
        survey_periode_id = process.env.SURVEY_PERIOD_ID;
    }

    const level = parseInt(process.env.LOOP_LEVEL || region.levelCount);

    let sql = fs.readFileSync(
        path.join(__dirname, "region_join.sql"),
        "utf-8"
    );

    let offset = 0;

    try {
        const index_main = fs.readFileSync(
            path.join(__dirname, "index_main.txt"),
            "utf-8"
        );

        offset = parseInt(index_main.trim(), 10);
        if (isNaN(offset)) offset = 0;

    } catch (e) {
        offset = 0;
    }

    sql = sql + ` OFFSET ${offset}`;
    const [tasks] = await sequelize.query(sql);

    const cliProgress = require("cli-progress");
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    const total = tasks.length;
    bar.start(total, 0);

    const [last_data] = await sequelize.query(
        `select '${survey_periode_id}' as id,max(dateModified) as dateModified from assignments`
    );

    await Last.bulkCreate(last_data, {
        updateOnDuplicate: ["dateModified"]
    });

    for (const task of tasks) {
        const body = {
            draw: 2,
            columns: [
                { data: "id", searchable: true },
                { data: "codeIdentity", searchable: true },
                { data: "data1", searchable: true },
                { data: "data2", searchable: true },
                { data: "data3", searchable: true },
                { data: "data4", searchable: true },
                { data: "data6", searchable: true }
            ],
            order: [{ column: 0, dir: "asc" }],
            start: 0,
            length: 1000,
            search: { value: "", regex: false },

            assignmentExtraParam: {
                region1Id: task.region1Id,
                region2Id: task.region2Id,
                region3Id: task.region3Id,
                region4Id: task.region4Id,
                region5Id: task.region5Id,
                region6Id: task.region6Id,
                surveyPeriodId: survey_periode_id,
                assignmentErrorStatusType: -1
            }
        };

        try {
            const result = await fetchWithRetry(page, body);

            const updateFields = Object.keys(Assignment.rawAttributes)
                .filter(field => field !== "id");

            await Assignment.bulkCreate(result.searchData, {
                updateOnDuplicate: updateFields
            });

        } catch (err) {
            console.log("🔥 Gagal total di task:", err.message);
        }

        bar.increment();
        fs.writeFileSync("index_main.txt", (offset + bar.value).toString());
    }

    bar.stop();
    await Unduh.bulkCreate([{"id" : "1", "start": now, "finish": new Date()}], {
        updateOnDuplicate: ["start", "finish"]
    });
    console.log("✅ Selesai download semua level");

    if (fs.existsSync("index_main.txt")) {
        fs.unlinkSync("index_main.txt");
    }

    await browser.close();
}

crawl();