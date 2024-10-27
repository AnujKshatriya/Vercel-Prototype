const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const AWS = require("aws-sdk");
const mime = require("mime-types");

const PROJECT_ID = process.env.PROJECT_ID;

// Configure Backblaze B2
const s3 = new AWS.S3({
  endpoint: "https://s3.us-east-005.backblazeb2.com",
  accessKeyId: "005b82fd142a4150000000001",
  secretAccessKey: "K005Jxogr9WrniRYmFmzoDztpsX1nuc",
  region: 'us-east-005',
  signatureVersion: 'v4'
});

async function uploadFileToB2( filePath, fileKey) {
  const fileStream = fs.createReadStream(filePath);
  const contentType = mime.lookup(filePath) || "application/octet-stream";

  return s3
    .upload({
      Bucket: "vercel-bucket",
      Key: fileKey,
      Body: fileStream,
      ContentType: contentType,
    })
    .promise();
}

async function init() {
  console.log("executing script.js ....");
  const outDirPath = path.join(__dirname, "output");

  const p = exec(`cd ${outDirPath} && npm install && npm run build`);

  p.stdout.on("data", function (data) {
    console.log(data.toString());
  });

  p.stdout.on("error", function (data) {
    console.error(data.toString());
  });

  p.on("close", async function () {
    console.log(`Build Completed`);

    const distFolderPath = path.join(__dirname, 'output', 'dist')
    const distFolderFiles = fs.readdirSync(distFolderPath, { recursive: true });

    for (const fileName of distFolderFiles) {
      const filePath = path.join(distFolderPath, fileName);

      // Skip if it's a directory
      if (fs.lstatSync(filePath).isDirectory()) continue;

      const fileKey = `__outputs/${PROJECT_ID}/${fileName}`; // Customize path in B2

      try {
        console.log("Trying to upload file...")
        await uploadFileToB2(filePath, fileKey);
        console.log(`Uploaded ${fileName} to Backblaze B2 as ${fileKey}`);
      } catch (err) {
        console.error(`Error uploading ${fileName}:`, err);
      }
    }

    console.log("All files uploaded to Backblaze B2");
  });
}

init();
