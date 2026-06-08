const cron = require("node-cron");

runJob = () => {
    console.log("Job is running...");
    // Add your job logic here
}

cron.schedule("35 15 * * *", () => {
    console.log("Running at 15:35");
    runJob();
});