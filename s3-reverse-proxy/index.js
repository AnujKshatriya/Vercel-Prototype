const express = require("express");
const httpProxy = require("http-proxy");
const axios = require("axios");

const app = express();
const PORT = 8000;

const BASE_PATH =
  "https://anuj-vercel-bucket.s3.ap-south-1.amazonaws.com/__outputs";

const proxy = httpProxy.createProxy();

app.use(async (req, res) => {
    const hostname = req.hostname;
    const subdomain = hostname.split(".")[0];
  
    try {
      // Fetch project details from the `api-server` based on the subdomain
      const response = await axios.get(`http://localhost:9000/getProjectId`, {
        params: { subdomain },
        timeout: 5000, // Optional timeout of 5 seconds
      });
  
      const projectId = response.data.projectId;
      const resolvesTo = `${BASE_PATH}/${projectId}`;
  
      return proxy.web(req, res, { target: resolvesTo, changeOrigin: true });
    } catch (error) {
      console.error("Error fetching project ID:", error.message || error);
      return res.status(500).send("Internal Server Error");
    }
  });

proxy.on("proxyReq", (proxyReq, req, res) => {
  const url = req.url;
  if (url === "/") proxyReq.path += "index.html";
});

app.listen(PORT, () => console.log(`Reverse Proxy Running..${PORT}`));
