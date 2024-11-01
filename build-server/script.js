const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const {PutObjectCommand, S3Client} = require('@aws-sdk/client-s3')
const mime = require("mime-types");

const PROJECT_ID = process.env.PROJECT_ID;

const s3Client = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey : process.env.AWS_SECRET_ACCESS_KEY,
  }
})

async function uploadFileToS3( filePath, fileKey) {
  const fileStream = fs.createReadStream(filePath);
  const contentType = mime.lookup(filePath) || "application/octet-stream";

  const command = new PutObjectCommand({
    Bucket: "anuj-vercel-bucket",
    Key: fileKey,
    Body: fileStream,
    ContentType: contentType,
  })

  return s3Client.send(command);
}

async function init() {
  console.log("executing script.js ....");
  const outDirPath = path.join(__dirname, "output");

  const p = exec(`cd ${outDirPath} && npm install && npm run build`);

  p.stdout.on("data", function (data) {
    console.log(data.toString());
  });

  p.stderr.on("data", function (data) {
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

      const fileKey = `__outputs/${PROJECT_ID}/${fileName}`; // Customize path in S3

      try {
        console.log("Trying to upload file ", fileName);
        await uploadFileToS3(filePath, fileKey);
        console.log(`Uploaded ${fileName} to AWS S3 as ${fileKey}`);
      } catch (err) {
        console.error(`Error uploading ${fileName}:`, err);
      }
    }

    console.log("All files uploaded to AWS S3");
  });
}

init();
