const puppeteer = require("puppeteer");
const Survey = require("./models/survey");
const RegionGroup = require("./models/regionGroup");
const Assignment = require("./models/assignment");
const Last = require("./models/Last");
const sequelize = require("./database");
const fs = require('fs');
const path = require('path');


require("dotenv").config();

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
    const survey = await Survey.findOne();
    let survey_periode_id = survey.surveyPeriods[0].id;
    if (process.env.SURVEY_PERIOD_ID) {
        survey_periode_id = process.env.SURVEY_PERIOD_ID;
    }
    const level = parseInt(process.env.LOOP_LEVEL || region.levelCount);
    // 🔥 ambil tasks

    let sql = fs.readFileSync(
        path.join(__dirname, 'region_join.sql'),
        'utf-8'
    );
    let offset = 0;

    try {
        const index_main = fs.readFileSync(
            path.join(__dirname, 'index_main.txt'),
            'utf-8'
        );

        offset = parseInt(index_main.trim(), 10);
        if (isNaN(offset)) offset = 0;

    } catch (e) {
        offset = 0;
    }

    sql = sql + ` OFFSET ${offset}`;
    const [tasks] = await sequelize.query(sql);
    // ambil XSRF token
    const cookies = await page.cookies();
    const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");
    const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;
    const cliProgress = require('cli-progress');

    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    const total = tasks.length;
    bar.start(total, 0);
    const [last_data] = await sequelize.query(`select '${survey_periode_id}' as id,max(dateModified) as dateModified from assignments_ngibar`);
    await Last.bulkCreate(last_data, {
        updateOnDuplicate: ["dateModified"]
    });
    // loop
    for (const task of tasks) {
        const body = {
            draw: 2,
            columns: [
                { data: "id", name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
                { data: "codeIdentity", name: "", searchable: true, orderable: false, search: { value: "", regex: false } },
                { data: "data1", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data2", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data3", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data4", name: "", searchable: true, orderable: true, search: { value: "", regex: false } },
                { data: "data6", name: "", searchable: true, orderable: true, search: { value: "", regex: false } }
            ],

            order: [{ column: 0, dir: "asc" }],
            start: 0,
            length: 1000,
            search: { value: "", regex: false },

            assignmentExtraParam: {
                region1Id: task['region1Id'],
                region2Id: task['region2Id'],
                region3Id: task['region3Id'],
                region4Id: task['region4Id'],
                region5Id: task['region5Id'],
                region6Id: task['region6Id'],
                region7Id: null,
                region8Id: null,
                region9Id: null,
                region10Id: null,

                surveyPeriodId: survey_periode_id,

                assignmentErrorStatusType: -1,
                assignmentStatusAlias: null,

                data1: null,
                data2: null,
                data3: null,
                data4: null,
                data5: null,
                data6: null,
                data7: null,
                data8: null,
                data9: null,
                data10: null,

                userIdResponsibility: null,
                currentUserId: null,

                regionId: null,
            }
        };
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

            return await res.json();
        }, xsrfToken, body);
        const updateFields = Object.keys(Assignment.rawAttributes)
            .filter(field => field !== 'id'); // exclude primary key
        if (result.searchData) {
            await Assignment.bulkCreate(result.searchData, {
                updateOnDuplicate: updateFields
            });
        }

        bar.increment();
        fs.writeFileSync('index_main.txt', (offset+bar.value).toString());
    }
    bar.stop();
    console.log("Selesai download semua level");
    // update last_data
    if (fs.existsSync('index_main.txt')) {
        fs.unlinkSync('index_main.txt');
    }
    await browser.close();
}

crawl();