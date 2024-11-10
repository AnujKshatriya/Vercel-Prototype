const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const mime = require("mime-types");
const { Kafka } = require("kafkajs");

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;    

const kafka = new Kafka({
    clientId: `docker-build-server-${DEPLOYMENT_ID}`,
    brokers: [process.env.KAFKA_BROKER],
    ssl: {
      ca: [fs.readFileSync(path.join(__dirname, "kafka.pem"), "utf-8")],
    },
    sasl: {
      username: "avnadmin",
      password: process.env.KAFKA_PASSWORD,
      mechanism: "plain",
    },
  });

const producer = kafka.producer();

async function publishLog(log) {
    await producer.send({ topic: "container-logs", messages: [{ key: 'log', value : JSON.stringify({PROJECT_ID, DEPLOYMENT_ID, log}) }] });
}

const s3Client = new S3Client({
    region: "ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,  // Use environment variable for security
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

async function uploadFileToS3(filePath, fileKey) {
    const fileStream = fs.createReadStream(filePath);
    const contentType = mime.lookup(filePath) || "application/octet-stream";

    const command = new PutObjectCommand({
        Bucket: "anuj-vercel-bucket",
        Key: fileKey,
        Body: fileStream,
        ContentType: contentType,
    });

    return s3Client.send(command);
}

async function init() {

    await producer.connect();

    console.log("Executing script.js ....");

    await publishLog("Building project");

    const outDirPath = path.join(__dirname, "output");

    const p = exec(`cd ${outDirPath} && npm install && npm run build`);

    p.stdout.on("data", async function (data) {
        console.log(data.toString());
        await publishLog(data.toString());
    });

    p.stderr.on("data", async function (data) {
        console.error(data.toString());
        await publishLog(`ERROR : ${data.toString()}`);
    });

    p.on("close", async function () {
        console.log(`Build Completed`);
        await publishLog("Build Completed");

        const distFolderPath = path.join(__dirname, 'output', 'dist');
        const distFolderFiles = fs.readdirSync(distFolderPath, { recursive: true });

        await publishLog(`Uploading files to AWS S3`);

        for (const fileName of distFolderFiles) {
            const filePath = path.join(distFolderPath, fileName);

            // Skip if it's a directory
            if (fs.lstatSync(filePath).isDirectory()) continue;

            const fileKey = `__outputs/${PROJECT_ID}/${fileName}`; // Customize path in S3

            try {
                console.log("Trying to upload file ", fileName);
                await publishLog(`Uploading ${fileName} to AWS S3`);
                await uploadFileToS3(filePath, fileKey);
                console.log(`Uploaded ${fileName} to AWS S3 as ${fileKey}`);
                await publishLog(`Uploaded ${fileName} to AWS S3`);
            } catch (err) {
                await publishLog(`Error uploading ${fileName}: ${err}`);
                console.error(`Error uploading ${fileName}:`, err);
            }
        }

        await publishLog("All files uploaded to AWS S3");
        console.log("All files uploaded to AWS S3");

        // Automatically exit the process after uploads
        console.log("Exiting container after upload...");
        process.exit(0);  // Exit to stop the ECS task
    });
}

init();
