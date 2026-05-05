const puppeteer = require("puppeteer");
const RegionGroup = require("./models/regionGroup");
const Level1 = require("./models/Level1");
const Level2 = require("./models/Level2");
const Level3 = require("./models/Level3");
const Level4 = require("./models/Level4");
const Level5 = require("./models/Level5");
const Level6 = require("./models/Level6");
const sequelize = require("./database");

require("dotenv").config();

const MAX_CONCURRENT = 3; // aman untuk puppeteer

async function crawl() {
    await sequelize.authenticate();
    console.log("Database connected");
    await sequelize.sync();

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

    const region = await RegionGroup.findOne();
    const level = parseInt(process.env.LOOP_LEVEL || region.levelCount);

    console.log("download level " + level);

    // 🔥 ambil tasks berdasarkan level
    let tasks = [];
    if (level === 1) tasks = await Level1.findAll({ raw: true });
    if (level === 2) tasks = await Level2.findAll({ raw: true });
    if (level === 3) tasks = await Level3.findAll({ raw: true });
    if (level === 4) tasks = await Level4.findAll({ raw: true });
    if (level === 5) tasks = await Level5.findAll({ raw: true });
    if (level === 6) tasks = await Level6.findAll({ raw: true });

    console.log("Total task:", tasks.length);

    // ambil token
    const cookies = await page.cookies();
    const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");
    const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;

    // queue system
    await runQueue(tasks, async (task) => {
        return await processTask(browser, task, level, xsrfToken);
    }, MAX_CONCURRENT);

    await browser.close();
}

async function processTask(browser, task, level, xsrfToken) {

    const page = await browser.newPage(); // 🔥 isolate page

    console.log("Start:", task.id);

    // 🔥 clone body
    const body = {
        draw: 1,
        columns: [],
        order: [{ column: 0, dir: "asc" }],
        start: 0,
        length: 1000,
        search: { value: "", regex: false },
        assignmentExtraParam: {
            region1Id: null,
            region2Id: null,
            region3Id: null,
            region4Id: null,
            region5Id: null,
            region6Id: null,
            surveyPeriodId: process.env.SURVEY_PERIOD_ID || null,
        }
    };

    // 🔥 set regionId dinamis
    const key = `region${level}Id`;
    body.assignmentExtraParam[key] = task.id;

    const result = await page.evaluate(
        async ({ xsrfToken, body }) => {

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

            return await res.json();
        },
        { xsrfToken, body }
    );
    result.data.forEach(item => {
        item.loop_id = task.id;
    });

    await Assignment.bulkCreate(result.data, {
        updateOnDuplicate: [
            "id",
        ]
    });
    
    console.log("Done:", task.id, result?.data?.length || 0);

    await page.close();
}

// 🔥 QUEUE ENGINE
async function runQueue(tasks, workerFn, max = 3) {
    let index = 0;
    let active = 0;

    return new Promise((resolve) => {

        function next() {
            if (index >= tasks.length && active === 0) {
                return resolve();
            }

            while (active < max && index < tasks.length) {
                const task = tasks[index++];
                active++;

                workerFn(task)
                    .catch(err => console.error(err))
                    .finally(() => {
                        active--;
                        next();
                    });
            }
        }

        next();
    });
}

crawl();