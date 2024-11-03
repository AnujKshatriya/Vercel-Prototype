const express = require('express');
const dotenv = require('dotenv');
const {Server} = require('socket.io');
const Redis = require('ioredis');
const {generateSlug} = require('random-word-slugs');
const {ECSClient, RunTaskCommand} = require('@aws-sdk/client-ecs')
const cors = require('cors');

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 9000;

const subscriber = new Redis(process.env.REDIS_URL);

subscriber.on('error', (err) => {
    console.error('Redis connection error:', err);
});

const io = new Server({ cors: "*" });

io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('subscribe', (channel) => {
        socket.join(channel);
        socket.emit('message', `Joined ${channel}`);
    });
});

const ecsClient = new ECSClient({
    region:"ap-south-1",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey : process.env.AWS_SECRET_ACCESS_KEY,
  }
})

const config = {
    CLUSTER : process.env.CLUSTER,
    TASK : process.env.TASK
}

app.use(express.json());

app.post('/project', async(req,res)=>{
    const {gitURL, userSlug} = req.body;
    const slug = userSlug ? userSlug :  generateSlug();

    const command = new RunTaskCommand({
        cluster: config.CLUSTER,
        taskDefinition: config.TASK,
        launchType: "FARGATE",
        count: 1,
        networkConfiguration: {
            awsvpcConfiguration: {
                subnets: ["subnet-0cbbb29b72c3a4bf2", "subnet-0546bf8c89c9f605f", "subnet-0da3adeded9a46dca"],
                securityGroups: ["sg-0d00a0cdc09f8000f"],
                assignPublicIp: "ENABLED"
            }
        },
        overrides: {
            containerOverrides: [
                {
                    name: "builder-image",
                    environment: [
                        {
                            name: "GIT_REPOSITORY_URL",
                            value: gitURL
                        },
                        {
                            name: "PROJECT_ID",
                            value: slug
                        }
                    ]
                }
            ]
        }
    });

    await ecsClient.send(command);

    return res.json({ status : "queued", data : {slug, url : `http://${slug}.localhost:8000`} });
});

async function handleRedisSubscribe() {
    console.log('Subscribing to logs');
    subscriber.psubscribe('logs:*');
    subscriber.on('pmessage', (pattern, channel, message) => {
        io.to(channel).emit('message', message);
    });
}
handleRedisSubscribe();

io.listen(9002, ()=>{
    console.log('Socket server is running on port 9002');
});

app.listen(PORT, () => {  
  console.log('Server is running on port ' + PORT);
});