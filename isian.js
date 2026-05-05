const puppeteer = require("puppeteer");
const Survey = require("./models/survey");
const RegionGroup = require("./models/regionGroup");
const Assignment = require("./models/assignment");
const AssigmentContent = require('./models/assignmentContent');
const Last = require("./models/Last");
const sequelize = require("./database");
const fs = require('fs');
const path = require('path');
const AssignmentContent = require("./models/assignmentContent");


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
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 600000 });

    let sql = fs.readFileSync(
        path.join(__dirname, 'assignment.sql'),
        'utf-8'
    );

    if (!process.env.ISIAN_ALL) {
        const last_data = await Last.findOne();
        const date = new Date(last_data.dateModified).toISOString();
        sql = `${sql} and dateModified > '${date}'`
    }

    let offset = 0;

    try {
        const index_main = fs.readFileSync(
            path.join(__dirname, 'index_asg.txt'),
            'utf-8'
        );

        offset = parseInt(index_main.trim(), 10);
        if (isNaN(offset)) offset = 0;

    } catch (e) {
        offset = 0;
    }

    sql = sql + ` ORDER BY id LIMIT 999999999 OFFSET ${offset}`;

    // 🔥 ambil tasks
    const [tasks] = await sequelize.query(sql);

    // ambil XSRF token
    const cookies = await page.cookies();
    const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");
    const xsrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;
    const cliProgress = require('cli-progress');

    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    const total = tasks.length;
    bar.start(total, 0);


    for (const task of tasks) {
        const result = await page.evaluate(async (xsrfToken,task) => {
            const res = await fetch(
                `https://fasih-sm.bps.go.id/assignment-general/api/assignment/get-by-id-with-data-for-scm?id=${task.id}`,
                {
                    method: "GET",
                    credentials: "include",
                    headers: {
                        "accept": "application/json",
                        "content-type": "application/json",
                        "x-xsrf-token": xsrfToken
                    },
                }
            );

            return await res.json();
        }, xsrfToken,task);
        let data = {}
        data['id'] = result.data._id
        data['pre_defined_data'] = JSON.parse(result.data.pre_defined_data)['predata']
        data['answer'] = JSON.parse(result.data.data)['answers']
        const updateFields = Object.keys(AssignmentContent.rawAttributes)
            .filter(field => field !== 'id'); // exclude primary key

        await AssignmentContent.bulkCreate([data], {
            updateOnDuplicate: updateFields
        });
        bar.increment();
        fs.writeFileSync('index_asg.txt', (offset + bar.value).toString());
    }
    bar.stop();
    console.log("Selesai download semua level");
    // update last_data
    if (fs.existsSync('index_asg.txt')) {
        fs.unlinkSync('index_asg.txt');
    }
    await browser.close();
}

crawl();