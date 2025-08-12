import express from "express";
import sqlite3 from "sqlite3";
import dotenv from "dotenv";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Database setup
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error("Database error:", err);
  else console.log("Database connected");
});
db.run(`CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caption TEXT,
    fileUrl TEXT,
    approvedBy TEXT,
    comments TEXT
)`);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// File upload
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/upload", upload.single("media"), async (req, res) => {
  try {
    const uploadRes = await cloudinary.uploader.upload_stream(
      { resource_type: "auto" },
      (error, result) => {
        if (error) return res.status(500).send(error);
        const { caption } = req.body;
        db.run(
          `INSERT INTO approvals (caption, fileUrl) VALUES (?, ?)`,
          [caption, result.secure_url],
          function (err) {
            if (err) return res.status(500).send(err.message);
            res.json({ success: true, id: this.lastID });
          }
        );
      }
    );
    uploadRes.end(req.file.buffer);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post("/approve/:id", (req, res) => {
  const { id } = req.params;
  const { user, comments } = req.body;
  db.run(
    `UPDATE approvals SET approvedBy = ?, comments = ? WHERE id = ?`,
    [user, comments, id],
    function (err) {
      if (err) return res.status(500).send(err.message);

      // Send email
      transporter.sendMail({
        from: process.env.SMTP_USER,
        to: process.env.NOTIFY_EMAIL,
        subject: "Post Approved",
        text: `Post ID ${id} approved by ${user}. Comments: ${comments || "None"}`
      });

      res.json({ success: true });
    }
  );
});

app.post("/generate-caption", async (req, res) => {
  const { promptText } = req.body;
  try {
    const completion = await openai.completions.create({
      model: "text-davinci-003",
      prompt: `Create a clear, concise Instagram caption for an electrical services business, also suitable for TikTok. Context: ${promptText}`,
      max_tokens: 50,
      temperature: 0.7
    });
    res.json({ caption: completion.choices[0].text.trim() });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
