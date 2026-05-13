import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  app.use((req, res, next) => {
    console.log(`Received ${req.method} request to ${req.url}`);
    next();
  });

  // API route for AI interaction
  app.post("/chat", async (req, res) => {
    console.log("Received POST /chat request");
    const { messages } = req.body;
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      console.error("NVIDIA_API_KEY missing");
      return res.status(500).json({ error: "NVIDIA_API_KEY not configured" });
    }
    
    try {
        const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "meta/llama-3.3-70b-instruct",
                messages,
                temperature: 0.7,
                max_tokens: 4096,
            })
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error("AI API Error Response:", errorText);
            return res.status(response.status).json({ error: "AI API returned an error", details: errorText });
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("AI API Error:", error);
        res.status(500).json({ error: "Failed to communicate with AI API" });
    }
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
