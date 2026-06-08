const puppeteer = require("puppeteer");
const Last = require("./models/Last");
const sequelize = require("./database");
const fs = require('fs');
const path = require('path');
const AssignmentContent = require("./models/assignmentContent");


require("dotenv").config();

const LOGIN_URL = "https://fasih-sm.bps.go.id/oauth2/authorization/ics";
const ASSIGNMENT_CONTENT_URL = "https://fasih-sm.bps.go.id/assignment-general/api/assignment/get-by-id-with-data-for-scm";
const PAGE_TIMEOUT = parseInt(process.env.PAGE_TIMEOUT || "600000", 10);
const FETCH_TIMEOUT = parseInt(process.env.FETCH_TIMEOUT || "600000", 10);
const MAX_DOWNLOAD_RETRY = parseInt(process.env.MAX_DOWNLOAD_RETRY || "3", 10);

async function login(page) {
    console.log("Login ke Fasih SM");
    await page.goto(LOGIN_URL, {
        waitUntil: "networkidle2",
        timeout: PAGE_TIMEOUT
    });

    const usernameInput = await page.$("#username");
    if (!usernameInput) {
        console.log("Sesi Fasih SM masih aktif");
        return;
    }

    await page.type("#username", process.env.USERNAME_COMMUNITY);
    await page.type("#password", process.env.PASSWORD_COMMUNITY);

    await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT }),
        page.click("#kc-login")
    ]);
}

async function getXsrfToken(page) {
    const cookies = await page.cookies();
    const xsrfCookie = cookies.find(c => c.name === "XSRF-TOKEN");
    return xsrfCookie ? decodeURIComponent(xsrfCookie.value) : null;
}

async function downloadAssignmentContent(page, task, xsrfToken) {
    return await page.evaluate(async ({ url, xsrfToken, taskId, timeout }) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const res = await fetch(`${url}?id=${taskId}`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "accept": "application/json",
                    "content-type": "application/json",
                    "x-xsrf-token": xsrfToken
                },
                signal: controller.signal
            });

            const text = await res.text();
            let data = null;

            try {
                data = text ? JSON.parse(text) : null;
            } catch (error) {
                throw new Error(`Response bukan JSON. HTTP ${res.status}`);
            }

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            return data;
        } finally {
            clearTimeout(timer);
        }
    }, { url: ASSIGNMENT_CONTENT_URL, xsrfToken, taskId: task.id, timeout: FETCH_TIMEOUT });
}

async function downloadAssignmentContentWithRetry(page, task) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_DOWNLOAD_RETRY; attempt++) {
        try {
            const xsrfToken = await getXsrfToken(page);
            if (!xsrfToken) {
                throw new Error("XSRF token tidak ditemukan");
            }

            const result = await downloadAssignmentContent(page, task, xsrfToken);
            if (!result || !result.data || !result.data._id || !result.data.pre_defined_data || !result.data.data) {
                throw new Error("Data hasil unduh tidak valid");
            }

            return result;
        } catch (error) {
            lastError = error;
            console.log(`Unduh isian ${task.id} gagal percobaan ${attempt}/${MAX_DOWNLOAD_RETRY}: ${error.message}`);

            if (attempt < MAX_DOWNLOAD_RETRY) {
                console.log("Mencoba login ulang sebelum mengulang unduh isian");
                await login(page);
            }
        }
    }

    throw lastError;
}

async function crawl() {
    await sequelize.authenticate();
    console.log("Database connected");
    await sequelize.sync();

    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT);
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT);

    // 🔐 LOGIN
    await login(page);

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

    const cliProgress = require('cli-progress');

    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

    const total = tasks.length;
    bar.start(total, 0);


    for (const task of tasks) {
        const result = await downloadAssignmentContentWithRetry(page, task);
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
