const express = require("express");
const dotenv = require("dotenv");
const { createClient } = require("@clickhouse/client");
const { generateSlug } = require("random-word-slugs");
const { z } = require("zod");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const { Kafka } = require("kafkajs");
const { v4 : uuidv4} = require('uuid')
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
app.use(cors());

const prisma = new PrismaClient();

const PORT = process.env.PORT || 9000;

const client = createClient({
  host : process.env.CLICKHOUSE_HOST,
  database: "default",
  username: "avnadmin",
  password: process.env.CLICKHOUSE_PASSWORD,
});

const kafka = new Kafka({
  clientId: `api-server`,
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

const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" });

const ecsClient = new ECSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const config = {
  CLUSTER: process.env.CLUSTER,
  TASK: process.env.TASK,
};

app.use(express.json());

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gitURL: z.string(),
  });

  const safeParseResult = schema.safeParse(req.body);

  if (safeParseResult.error) {
    return res.status(400).json({ error: safeParseResult.error });
  }

  const { name, gitURL } = safeParseResult.data;

  const project = await prisma.project.create({
    data: {
      name,
      giturl: gitURL,
      subdomain: generateSlug(),
    },
  });

  return res.json({ status: "success", data: { project } });
});

app.post("/deploy", async (req, res) => {
  const { projectId } = req.body;

  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) return res.status(404).json({ error: "Project not found" });

  const deployment = await prisma.deployment.create({
    data: {
      project: { connect: { id: projectId } },
      status: "QUEUED",
    },
  });

  const command = new RunTaskCommand({
    cluster: config.CLUSTER,
    taskDefinition: config.TASK,
    launchType: "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: [
          "subnet-0cbbb29b72c3a4bf2",
          "subnet-0546bf8c89c9f605f",
          "subnet-0da3adeded9a46dca",
        ],
        securityGroups: ["sg-0d00a0cdc09f8000f"],
        assignPublicIp: "ENABLED",
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "builder-image",
          environment: [
            {
              name: "GIT_REPOSITORY_URL",
              value: project.giturl,
            },
            {
              name: "PROJECT_ID",
              value: projectId,
            },
            {
              name: "DEPLOYMENT_ID",
              value: deployment.id.toString(),
            },
          ],
        },
      ],
    },
  });

  await ecsClient.send(command);

  return res.json({
    status: "queued",
    data: { deploymentId : deployment.id },
  });
});

async function initKafkaConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topics: ["container-logs"] });

  await consumer.run({
    autoCommit: false,

    eachBatch: async ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }) => {

      const messages = batch.messages;
      console.log("Recieved messages with length", messages.length);

      for (const message of messages) {
        if (!message.value) continue;
        const stringMessage = message.value.toString();
        const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage);

        try {
          await client.insert({
            table: "log_events",
            values : [{event_id : uuidv4(), deployment_id : DEPLOYMENT_ID, log}],
            format: "JSONEachRow"
          })
          await commitOffsetsIfNecessary(message.offset);
          resolveOffset(message.offset);
          await heartbeat();
        } 
        catch (error) {
          console.error("Error while inserting log into clickhouse", error);
        }
      }
    },
  });
}

initKafkaConsumer();


app.listen(PORT, () => {
  console.log("Server is running on port " + PORT);
});
